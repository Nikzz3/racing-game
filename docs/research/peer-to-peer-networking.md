# Research: should Sunset Ridge Racing move remote-car poses to peer-to-peer WebRTC? (2026-09)

The question: the Node `ws` server currently relays each client's car pose (~20 Hz) to the
other players in a Room, and the clients interpolate the remote cars. Should we replace this
client-server design with peer-to-peer networking? If so, how much should change: a full P2P
rebuild, or a hybrid where the server keeps signaling and leaderboard authority while peers
exchange poses directly? What latency would we actually gain, and what would it cost in
infrastructure, dependencies and testing?

The context comes from the brief, not the repo. ADR-0005 (see
[best-tech-stack-2026.md §5](best-tech-stack-2026.md#5-networking--realtime-transport-and-netcode))
makes physics client-authoritative and the server a lap-plausibility judge. Car-car collisions
are resolved on each client, which pushes its own car away from remote cars. The server
validates laps, persists them to Postgres and serves Replays and the leaderboard over HTTP. It
is deployed on Railway.

Every external claim below is checked against the source that owns it: W3C/IETF specs, MDN,
Chromium source, library READMEs and source, npm and GitHub release data, and first-party
pricing pages. Versions and dates are as of **2026-09-23**. Anything I could not verify
against a primary source is marked **secondary** or **unverified**.

**Verified locally on 2026-09-23** (throwaway probes in `/tmp`, not committed):

- On Node 24.21.0 with Vitest 5.0.1, **`node-datachannel` 0.33.4 (polyfill), `werift` 0.24.4
  and `@roamhq/wrtc` 0.10.0 all open an in-process loopback pair** with
  `{ordered:false, maxRetransmits:0}` and deliver 50 × 40-byte binary messages. Time to
  channel open: 1 ms, 161 ms and 3 ms respectively.
- Headless Chromium from Playwright 1.61.1 (chromium-1228) connected two pages with
  `iceServers: []` in every case: two contexts in one browser, two separate browsers, with
  mDNS obfuscation on and off, on the host and in a Podman container with a normal network.
  `pc.sctp.maxMessageSize` was 262144.
- In a container started with `--network none` (loopback only), **Chromium, node-datachannel
  and werift all gathered zero ICE candidates, and the connection never opened**. This held
  even with `--allow-loopback-in-peer-connection`.
- `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` also produces zero candidates.
  That gives a one-flag way to force the fallback path in e2e tests.

> **Headline for our decision.** **Don't do a full P2P rebuild.** Build a **hybrid "dual-path"
> transport** instead. The server keeps everything it does now: Rooms, lobby, signaling, lap
> validation, leaderboard, Replays, and the WebSocket pose relay. In addition, each pair of
> peers opens one **raw `RTCPeerConnection`** carrying a **pre-negotiated unordered,
> zero-retransmit DataChannel**, and sends each pose on both paths. The receiver keeps
> whichever copy of a sequence number arrives first. This makes fallback automatic (the
> relay never stops) and keeps the server able to observe live poses. The only new
> infrastructure is optional TURN (**Cloudflare Realtime TURN, $0.05/GB after 1,000 GB/month
> free**). Railway **cannot host a useful coturn**, because its public ingress is HTTP plus
> TCP proxy only, with no UDP. The latency win is real but modest. It shows up mainly as
> **fewer loss-induced stalls** (no TCP head-of-line blocking) and **one less network leg**
> (A→B instead of A→server→B). Expect roughly 10–60 ms off one-way pose latency for most
> pairs and much larger p99 improvements on lossy links. The median player will barely
> notice it next to the ~100–150 ms interpolation buffer. Ship it only after cheaper wins
> (binary poses, buffer tuning) and after pose-age telemetry shows the relay is the
> bottleneck.

---

## 1. WebRTC DataChannels for game state

**Stack and reliability modes.** A DataChannel is SCTP over DTLS over ICE/UDP
([RFC 8831 §1, §6.1](https://www.rfc-editor.org/rfc/rfc8831.html); DTLS encapsulation per
[RFC 8261](https://www.rfc-editor.org/rfc/rfc8261.html)). Partial reliability is mandatory to
implement, and _"Limiting the number of retransmissions to zero, combined with unordered
delivery, provides a UDP-like service"_ (RFC 8831 §6.1). Ordering and reliability are
properties of each SCTP message, not of the stream (§6.4). In the browser API:

- `createDataChannel(label, { ordered: false, maxRetransmits: 0 })`. `ordered` defaults to
  `true`, and both `maxRetransmits` and `maxPacketLifeTime` default to `null` (fully
  reliable). Setting both throws `SyntaxError`. With `negotiated: true, id: n`, both sides
  create the channel themselves and no in-band DCEP handshake is needed
  ([MDN createDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel)).
- `RTCPeerConnection.createDataChannel` has been **Baseline widely available since January
  2020** (MDN). This covers Chrome, Edge, Firefox and Safari. Electron renderers use
  Chromium's WebRTC stack, and Electron adds
  [`webContents.setWebRTCIPHandlingPolicy`](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwebrtciphandlingpolicypolicy)
  and `setWebRTCUDPPortRange` for desktop-only control.
- Encryption is mandatory. Everything is DTLS-encrypted
  ([MDN Using data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)).

**Message size.** Without message interleaving
([RFC 8260](https://www.rfc-editor.org/rfc/rfc8260.html)), _"the sender SHOULD limit the maximum
message size to 16 KB to avoid monopolization"_ (RFC 8831 §6.6). The limit is negotiated with
the SDP attribute `max-message-size` ([RFC 8841](https://www.rfc-editor.org/rfc/rfc8841.html)),
which defaults to 64 KB when absent. MDN says most modern browsers support at least 256 KB,
and we measured 262144 in Chromium. **This does not matter for us**: a pose is ~40 bytes
binary, or 73–92 bytes as today's JSON
([best-tech-stack-2026 §7](best-tech-stack-2026.md#7-shared-schema-and-serialization)). The
initial path MTU "SHOULD NOT exceed 1200 bytes" (RFC 8831 §5), so every pose fits in one
packet.

**Per-packet overhead (IPv4, one 40-byte pose).** Header sizes come from the specs:
SCTP common header 12 B + DATA chunk header 16 B ([RFC 9260 §3](https://www.rfc-editor.org/rfc/rfc9260.html));
DTLS 1.2 record header 13 B ([RFC 6347 §4.1](https://www.rfc-editor.org/rfc/rfc6347.html))

- AES-GCM explicit nonce 8 B and tag 16 B ([RFC 5288 §3](https://www.rfc-editor.org/rfc/rfc5288.html));
  UDP 8 B; IPv4 20 B.

| Path                       | Headers                                                                                      | Wire bytes / pose | At 20 Hz              |
| -------------------------- | -------------------------------------------------------------------------------------------- | ----------------- | --------------------- |
| DataChannel (DTLS 1.2 GCM) | IP 20 + UDP 8 + DTLS 13 + nonce 8 + tag 16 + SCTP 12 + DATA 16 = **93**                      | **133 B**         | 2.66 KB/s ≈ 21 kbit/s |
| WebSocket over TLS 1.3     | IP 20 + TCP 32 (with timestamps) + TLS record 5+1+16 + WS 2 (6 if client-masked) = **76–80** | **116–120 B**     | 2.3 KB/s ≈ 19 kbit/s  |

WebSocket frame header sizes are from [RFC 6455 §5.2](https://www.rfc-editor.org/rfc/rfc6455.html#section-5.2)
and the TLS 1.3 record layout from [RFC 8446 §5.2](https://www.rfc-editor.org/rfc/rfc8446.html#section-5.2).
The two overheads are about the same, so **bandwidth is not the argument for either
transport**. SCTP SACKs travel in the reverse direction but mostly bundle with DATA, because
both peers send at 20 Hz. Budget up to +25% as a worst case (my estimate, **unverified**).

**Head-of-line blocking, which is the actual latency argument.** TCP delivers in order, so one
lost segment holds back every later pose until it is retransmitted.
[Gaffer on Games (2017)](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/):
_"The most recent data they want is delayed while waiting for old data to be resent… since
WebSockets are implemented on top of TCP, data is still subject to head of line blocking."_
With sparse 20 Hz traffic, fast retransmit (which needs three duplicate ACKs, i.e. three
later segments = 150 ms of poses) rarely fires first. Recovery then comes from tail-loss
probing, whose PTO is `2 * SRTT`
([RFC 8985](https://www.rfc-editor.org/rfc/rfc8985.html)), or from the RTO. Linux floors the
RTO at `HZ/5` = 200 ms ([include/net/tcp.h](https://github.com/torvalds/linux/blob/master/include/net/tcp.h)),
and RFC 6298 §2.4 recommends a 1 s floor ([RFC 6298](https://www.rfc-editor.org/rfc/rfc6298.html)).
So **each lost packet stalls all remote cars for roughly 2×RTT to 200+ ms**, and the queued
poses then arrive in a burst. On an unordered, zero-retransmit channel, the lost pose is
simply skipped and interpolation moves on to the next one
([Gaffer, Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)).
`ws` already disables Nagle (`socket.setNoDelay()`,
[ws 8.21.3 lib/websocket.js](https://github.com/websockets/ws/blob/8.21.3/lib/websocket.js)),
so Nagle is not part of today's latency.

**Consequence for the receiver.** With `ordered:false`, a pose can arrive after a newer one.
Every pose must carry a monotonic `seq`/tick, and the receiver drops anything not newer than
the last one it accepted. The dual-path design needs this deduplication anyway.

---

## 2. Topology for 2–8 players

Per-client figures use 133 B/pose on the wire at 20 Hz (21.3 kbit/s per stream), and 116 B
on the WS relay.

| Topology                                   | Hops A→B        | Client up / down (N=8)                                    | Connections                       | Notes                                                                                                                                                            |
| ------------------------------------------ | --------------- | --------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server relay (today)**                   | 2 (via Railway) | up 19 kbit/s; down 7 × 18.6 = 130 kbit/s                  | 1 WS each                         | Server egress per full 8-player Room: 56 streams ≈ 1.04 Mbit/s ≈ 0.47 GB/h (≈ $0.02/h at Railway's $0.05/GB)                                                     |
| **Full mesh**                              | 1 (direct)      | up = down = 7 × 21.3 ≈ **149 kbit/s**                     | N−1 = 7 each; N(N−1)/2 = 28 total | Trivial bandwidth for any broadband or 4G link. Setup cost is 7 ICE+DTLS handshakes per client. One bad pair affects only that pair                              |
| Host-authoritative star (one peer is host) | 2 (via host)    | host up ≈ 7 × 7 × 21.3 ≈ **1.04 Mbit/s**; others as relay | N−1 at host, 1 elsewhere          | Moves the relay onto a residential uplink, adds host-migration logic, and has no authority to exploit because physics is client-authoritative. **Worst of both** |

The per-client mesh load at N = 2, 4 and 8 is 21, 64 and 149 kbit/s each way. **Full mesh is
the right P2P topology for ≤ 8 players sending 40-byte poses.** Mesh limits usually quoted
for WebRTC come from video bitrates, not from 20 Hz pose data. A star topology only makes
sense for server-authoritative simulation, which ADR-0005 rejects.

---

## 3. Signaling and lobby

WebRTC defines no signaling transport. The app carries the SDP offers/answers and ICE
candidates over its own channel
([MDN Perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation);
[W3C WebRTC 1.0](https://www.w3.org/TR/webrtc/)). Valve's SDR docs describe the same shape: a
signaling service forwards _"occasional rendezvous messages used to negotiate routing"_,
typically _"a initial exchange 4-10 messages"_
([Steam Datagram Relay](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay)).

**The existing `ws` server should be the signaling server.** It already authenticates the
socket, knows Room membership and reconnects with backoff. Add one message type:

```ts
// client -> server -> client, forwarded only if `to` is in the sender's Room
{ type: "rtc-signal", to: PlayerId, from: PlayerId /* set by server */, data:
  { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit } }
```

- The server overwrites `from`, rejects any `to` outside the Room, and caps the message size
  (SDP is a few KB).
- Use **perfect negotiation** (MDN): identical code on both sides and a deterministic
  `polite` role (for example, the lower `PlayerId` is polite), so offer glare needs no special
  cases. Use a **pre-negotiated channel** (`negotiated: true, id: 0`) so there is no
  `ondatachannel` race. Also set `alwaysNegotiateDataChannels` or create the channel before
  the first offer (MDN createDataChannel).
- **Room and lobby discovery stays exactly as it is.** Libraries that do discovery over public
  infrastructure (Trystero's default Nostr relays, BitTorrent trackers, MQTT brokers) solve a
  problem we don't have. They would also add a third party to our trust boundary.
- On Room join, the server pushes the peer list, and the new joiner offers to each existing
  peer (or the pair is decided by `polite`). On leave or reconnect, the server tells peers to
  close that `RTCPeerConnection`.

---

## 4. NAT traversal: STUN, TURN, and what fraction of pairs need a relay

**Mechanics.** ICE ([RFC 8445](https://www.rfc-editor.org/rfc/rfc8445.html)) tries host,
server-reflexive (STUN, [RFC 8489](https://www.rfc-editor.org/rfc/rfc8489.html)) and relay
(TURN, [RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html)) candidate pairs. STUN costs
almost nothing: it is one request per gathering. TURN relays every byte. **Direct P2P fails
when both sides sit behind endpoint-dependent (symmetric) NATs, or when a firewall blocks
UDP.** Those users need TURN over UDP, or TURN over TCP/TLS on port 443. **TURN over TCP puts
head-of-line blocking back**, so it only buys connectivity, not latency.

**How often is TURN needed?** There is no authoritative current number. All published figures
are old, and they depend on who the users are:

| Figure                                                                                                              | Source                                                                                                                                                   | Quality                                             |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| "Most large vendors I've spoken to report 20% TURN relay traffic. Some reported over 30%"                           | Tsahi Levent-Levi, [discuss-webrtc, 2018-06-21](https://groups.google.com/g/discuss-webrtc/c/5d_EJwM6iJM)                                                | Practitioner, first-hand survey                     |
| appear.in: 12.1% TURN/UDP, 5% TURN/TCP, <0.5% TURN/TLS (≈17.7% relayed)                                             | Philipp Hancke, [Medium, 2017](https://medium.com/@fippo/what-kind-of-turn-server-is-being-used-d67dbfc2ff5d) (403 to fetch; figures via search snippet) | **Secondary** as retrieved                          |
| Hole punching succeeds **70% ± 7.1%** (4.4 M attempts, 85k networks, 167 countries); TCP and QUIC indistinguishable | Trautwein et al., [arXiv:2510.27500](https://arxiv.org/abs/2510.27500), [arXiv:2604.12484](https://arxiv.org/abs/2604.12484) (libp2p DCUtR, not ICE)     | Peer-reviewed-style measurement, different protocol |

**Planning figure: 10–30% of pairs need TURN on consumer networks, and more on corporate or
campus networks.** Once shipped, measure our own rate from the selected candidate pair's
`candidateType === "relay"` in `getStats()`
([MDN RTCIceCandidateStats](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidateStats)).
Epic's advice applies to us: _"due to the bandwidth costs and latency associated with TURN,
we recommend you only use TURN as a last resort"_
([EOS P2P reference](https://dev.epicgames.com/docs/epic-online-services/multiplayer/nat-p2p-interface/p2p-reference)).
In the dual-path design, **a pair without a direct path just keeps using the WS relay**. So
**TURN is optional for v1**, and arguably pointless: a relayed pair is no faster than our
relay unless TURN over UDP avoids HOL blocking and Cloudflare's anycast edge is closer than
Railway.

**STUN servers.** `stun:stun.l.google.com:19302` is widely used, and Google's own
[webrtc/samples trickle-ICE page](https://github.com/webrtc/samples/blob/gh-pages/src/content/peerconnection/trickle-ice/js/main.js)
defaults to it, but it has **no published SLA or usage policy** (**unverified** as to terms).
Cloudflare publishes `stun:stun.cloudflare.com:3478`
([Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/)). List both.

**TURN options and cost** (first-party pricing pages, 2026-09-23):

| Provider                     | Price                                                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Realtime TURN** | **$0.05/GB egress; first 1,000 GB/month free** (shared with SFU) ([pricing](https://developers.cloudflare.com/realtime/pricing/)) | Anycast. UDP/TCP 3478 (alt 80), TLS 5349 (alt 443). Short-lived credentials: backend POSTs `{ttl}` to `https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers` and gets a ready `iceServers` array; revocable ([generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)). Per-allocation limits ≈ 5–10 kpps, 50–100 Mbit/s |
| Metered                      | Free 500 MB/mo; Growth $99/mo for 150 GB (+$0.40/GB); Business $199/500 GB ([pricing](https://www.metered.ca/stun-turn))          | Free tier too small to rely on                                                                                                                                                                                                                                                                                                                                                                      |
| Twilio NTS                   | $0.40/GB (US/EU), $0.60–0.80/GB elsewhere; STUN free ([pricing](https://www.twilio.com/en-us/stun-turn/pricing))                  | 8× Cloudflare's price                                                                                                                                                                                                                                                                                                                                                                               |
| coturn, self-hosted          | VM cost + egress                                                                                                                  | [coturn 4.18.0](https://github.com/coturn/coturn/releases) (2026-09-08), active. Needs a public UDP port range, so it needs a host with UDP (Fly.io, Hetzner)                                                                                                                                                                                                                                       |

**Cost check:** one TURN-relayed pair uses about 2 × 2.66 KB/s ≈ 19 MB/hour of Cloudflare
egress. **1,000 GB free ≈ 50,000 relayed pair-hours a month**, so it is effectively free at
our scale.

**Can Railway host coturn? Not usefully.** Railway public networking is HTTP/1.1, HTTP/2 and
WebSockets through its edge
([Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)),
plus a **TCP Proxy** that gives one Railway-assigned `host:port` per service
([TCP Proxy](https://docs.railway.com/networking/tcp-proxy)). UDP is documented only for the
**private** Wireguard network between services
([private networking](https://docs.railway.com/networking/private-networking/how-it-works)).
A coturn instance on Railway could therefore offer only TURN over TCP, on a random
non-443 port. That path is client → Railway → client over TCP, which is topologically what
the `ws` relay already does, plus a DTLS/SCTP layer. **Verdict: use Cloudflare, or skip TURN.**

**Privacy.** Direct P2P shows each player's **public IP** to everyone in the Room. mDNS only
hides _local_ addresses
([draft-ietf-mmusic-mdns-ice-candidates](https://datatracker.ietf.org/doc/draft-ietf-mmusic-mdns-ice-candidates/),
expired but shipped; Chromium `kWebRtcHideLocalIpsWithMdns` is `FEATURE_ENABLED_BY_DEFAULT`,
[blink features.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc)).
See also [RFC 8828](https://www.rfc-editor.org/rfc/rfc8828.html). Valve's stated reason for SDR
is that relaying _"protects your servers and players from DoS attack, because IP addresses
are never revealed"_ (Steam SDR docs). For a public leaderboard game where strangers share
Rooms, **make direct connections a setting** ("Direct connections: on/off"), or enable them
only in invite/private Rooms. `iceTransportPolicy: "relay"` ([W3C WebRTC](https://www.w3.org/TR/webrtc/#dom-rtcicetransportpolicy))
is the relay-only escape hatch.

---

## 5. Libraries

Maintenance data comes from the npm registry and the GitHub API, 2026-09-23.

| Library                     | Latest (date)           | Activity                           | What it gives                                                                                    | Fit                                                                                                                                                                                                                           |
| --------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Raw `RTCPeerConnection`** | platform                | Baseline 2020                      | Everything, zero deps                                                                            | **Winner.** Perfect negotiation is ~60 lines (MDN). Our signaling and Rooms already exist                                                                                                                                     |
| `simple-peer`               | 9.11.1 (**2022-02-17**) | last push 2024-06; 128 open issues | Wraps offer/answer, Node streams                                                                 | **Unmaintained.** Pulls `readable-stream`, `buffer`                                                                                                                                                                           |
| `@thaunknown/simple-peer`   | 10.1.2 (2026-07-25)     | maintained fork (39★)              | ESM, `streamx`/`Uint8Array`, `lite.js` data-only build; `channelConfig` passthrough              | Acceptable, but it's a single-maintainer fork and adds 5 deps for code we'd write in 60 lines                                                                                                                                 |
| PeerJS                      | 1.5.5 (2025-06-07)      | last push 2026-02                  | Peer IDs + PeerServer broker (default cloud `0.peerjs.com`)                                      | Wants its own PeerServer. `reliable:false` maps only to `{ordered:false}` with **no retransmit limit** ([negotiator.ts](https://github.com/peers/peerjs/blob/master/lib/negotiator.ts)), so no UDP-like mode. 2.1 MB unpacked |
| Trystero                    | 0.25.4 (2026-08-30)     | very active                        | Serverless discovery (Nostr default; MQTT/torrent/Supabase/Firebase/IPFS/self-hosted `ws-relay`) | Opens a single default **reliable, ordered** channel (`pc.createDataChannel('data')`, [peer.ts](https://github.com/dmotz/trystero/blob/main/packages/core/src/peer.ts)), so no HOL win. Its discovery duplicates our Rooms    |
| geckos.io                   | 3.1.0 (2026-03-27)      | quiet since                        | Client↔**server** WebRTC over UDP (node-datachannel inside)                                      | Not P2P. Server needs a public UDP port range, which **Railway can't provide**                                                                                                                                                |
| netplayjs                   | 0.4.1 (**2023-04-02**)  | last push 2024-10                  | Rollback/lockstep over PeerJS                                                                    | Needs deterministic rewindable sim, and it's stale. Wrong model                                                                                                                                                               |

**Node-side WebRTC, for Vitest and integration tests** (all verified on Node 24.21.0 +
Vitest 5.0.1, see the probe list at the top):

| Library                                                                          | Latest                       | Engine / footprint                                                                                                                                 | Result                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`node-datachannel`** ([repo](https://github.com/murat-dogan/node-datachannel)) | 0.33.4 (2026-09-12), MPL-2.0 | libdatachannel; **N-API 8**, "supports Node.js v18.20 and above (including Node.js 20, 22, and 24+)"; prebuilt per-platform optional deps (~10 MB) | ✅ Opens in 1 ms. `node-datachannel/polyfill` exports W3C-shaped `RTCPeerConnection`. **Quirk:** a channel received via `ondatachannel` reports `ordered:true, maxRetransmits:null` even though the sender set `false/0`. With `negotiated:true` both sides report correctly |
| `werift` ([repo](https://github.com/shinyoshiaki/werift-webrtc))                 | 0.24.4 (2026-08-10), MIT     | Pure TypeScript, 9 deps (~6 MB)                                                                                                                    | ✅ Open in ~160 ms. Same `ondatachannel` reporting quirk. Good fallback if native binaries are a problem                                                                                                                                                                     |
| `@roamhq/wrtc` ([repo](https://github.com/WonderInventions/node-webrtc))         | 0.10.0 (2026-03-10)          | libwebrtc native (~26 MB linux-x64); no GitHub releases, sporadic WIP commits                                                                      | ✅ Most spec-faithful (reports remote channel props correctly), but heaviest and least predictable maintenance                                                                                                                                                               |
| `wrtc` (original)                                                                | 0.4.7 (2021-01)              | —                                                                                                                                                  | ❌ Dead                                                                                                                                                                                                                                                                      |

**Recommendation.** Use **raw `RTCPeerConnection` in the client, with zero new runtime
dependencies**, behind a small `PeerLink` module (a deep module with a narrow interface:
`send(pose)`, `onPose`, `state`). Add **`node-datachannel` as a devDependency** for
integration tests that drive the real signaling server from Node through
`node-datachannel/polyfill`. Most `PeerLink` logic (dedupe, path selection, timeouts) should
be unit-tested with an in-memory fake link, not real WebRTC.

---

## 6. Trust and anti-cheat

P2P does not change the trust model. Physics is already client-authoritative, and the server
already trusts only what it can check. What changes:

- **The leaderboard still needs the server.** Lap submission stays a client→server HTTP/WS
  call carrying the lap's evidence (samples or Replay). The plausibility checks (speed bounds,
  no teleports) run on **that submission**, never on anything peers told each other. Nothing
  P2P touches ever reaches Postgres.
- **Losing the passive view of live poses.** If the server currently uses relayed poses for
  anything, such as Room race standings, finish order, AFK or disconnect detection,
  spectating or recording Replays from the stream, a pure P2P design removes that input.
  **The dual-path design keeps it**, because every pose still goes to the server.
- **Equivocation is new.** In a mesh, a cheater can send _different_ poses to different peers.
  The effect is cosmetic or collision-local, because each client resolves only its own car.
  It can't touch the leaderboard. Race results must stay server-decided, based on validated
  lap submissions.
- **New risks are IP exposure and peer-to-peer DoS.** See §4 Privacy. Rate-limit and
  size-check incoming DataChannel messages exactly as the server does for WS messages (a
  pose is a fixed size, so drop anything else).

**Server roles that remain:** auth/identity, Rooms and lobby, **signaling**, TURN credential
minting (if used), **WS pose relay (fallback, always on in v1)**, lap plausibility
validation, the Postgres leaderboard, and Replay/leaderboard HTTP.

---

## 7. Fallback design: how hybrids work, and what to build

Industry pattern: **P2P when it works, a relay when it doesn't, and the game never cares.**
Steam's SDR relays P2P traffic through Valve's backbone and can fall back to _"direct UDP
connectivity or attempt NAT punch"_ (Steam SDR docs). EOS P2P tries several methods in order,
with `EOS_RC_NoRelays` / `EOS_RC_AllowRelays` / `EOS_RC_ForceRelays`
([EOS_ERelayControl](https://dev.epicgames.com/docs/api-ref/enums/eos-e-relay-control)). For
us, the "relay" is the WS server we already run.

**Recommended v1: dual-path, first-arrival wins.**

1. The sender stamps each pose with `seq`. It sends the pose **on the WS as today** and also
   on each open `PeerLink` DataChannel (`negotiated:true, id:0, ordered:false,
maxRetransmits:0`).
2. The receiver keeps `lastSeq[peer]`, accepts the first copy with `seq > lastSeq`, and drops
   the other copy. Per-pair fallback is implicit: if ICE fails, never connects, or drops
   mid-race, the WS copies keep arriving. **There is no fallback state machine and no switch
   glitch.**
3. Connection lifecycle: attempt on Room join. Use an app-level timeout of about 5–10 s and
   give up quietly, with no retry storm (reuse the existing backoff helper for retries).
   Close the link on leave. `pc.restartIce()` handles `connectionState === "failed"`.
4. Telemetry: per pair, report `path = direct|relay`, candidate type (`host/srflx/relay`), and
   pose age at arrival for each path. This data is what later justifies (or kills) phase 2.

**Phase 2, only if egress or server CPU matters:** once a direct link has been healthy for N
seconds, the receiver tells the server "direct-ok for peer X", and the server stops relaying
X→receiver. If the direct link goes stale (no pose for ~250 ms), the receiver sends
"direct-lost" and the server resumes. This costs one small state machine on the server. At
today's scale, egress is about $0.02 per full-Room hour (§2), so phase 2 is probably never
needed.

**Why not "WebRTC first, WS only on failure"?** Detecting failure takes seconds (ICE checks),
mid-race drops need a handover, and the server loses its view of live poses. Dual-path avoids
all three at the cost of today's bandwidth, which we already pay.

---

## 8. Testing WebRTC

**Vitest (Node 24).** Use `node-datachannel/polyfill` for real-stack integration: two
`RTCPeerConnection`s signaled through the real `ws` server in-process, with
`iceServers: []`. Host candidates on the machine's interface are enough. Use **negotiated
channels**, because the polyfill misreports reliability props on `ondatachannel` channels
(verified). Unit-test `PeerLink` dedupe and path logic against an in-memory fake.

**Playwright (Chromium).** No media flags are needed. `--use-fake-ui-for-media-stream` and
`--use-fake-device-for-media-stream`
([webrtc.org testing](https://webrtc.github.io/webrtc-org/testing/)) only matter for
`getUserMedia`. Verified on Playwright 1.61.1 / chromium-1228:

- **Two contexts in one browser**, which is how multi-player e2e usually runs, connect with
  default settings, including mDNS `.local` host candidates.
- **`--disable-features=WebRtcHideLocalIpsWithMdns`** makes host candidates raw IPs
  (`192.168.x.x`, IPv6), so connectivity no longer depends on mDNS resolution and multicast,
  and candidates are readable in logs. Recommended for the e2e project config.
- **The container must have a non-loopback interface.** With `podman run --network none`,
  Chromium, node-datachannel and werift all gathered **zero candidates**, even with
  `--allow-loopback-in-peer-connection` (a real switch, "Allows loopback interface to be
  added in network list for peer connection",
  [content_switches.cc](https://chromium.googlesource.com/chromium/src/+/main/content/public/common/content_switches.cc)).
  Default bridge/pasta networking and GitHub-hosted runners have one.
- **Forcing the fallback path:** launch one browser with
  `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  ([chrome_switches.cc](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/chrome_switches.cc)).
  It gathers no candidates, so the pair must run on the WS relay. Assert that remote cars
  still move and telemetry says `path=relay`. The flag is per browser, so this test needs a
  second `chromium.launch()`, not a second context.
- For debugging, the `--webrtc-event-logging=<dir>` switch writes event logs without
  `chrome://webrtc-internals` (same source file).

**Electron.** The renderer uses Chromium's WebRTC, so no extra dependency is needed. I did not
exercise the desktop smoke test with WebRTC here (**unverified**). The xvfb/no-sandbox flags
from the existing smoke test don't affect networking.

---

## 9. Recommendation and realistic latency win

**Where the latency goes today** for remote car B as seen by A: B's send tick (0–50 ms at
20 Hz) → B→server → server→A → **interpolation buffer**. Gaffer's rule for tolerating two
consecutive losses is 3 × the send interval, which is **150 ms at 20 Hz** plus jitter
([Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)). The buffer
is the largest term, and P2P doesn't shrink it by itself.

**What direct P2P removes:**

- **One network leg:** `d(A,S) + d(S,B)` becomes `d(A,B)`. With two players in the same metro
  area and 20–30 ms from the Railway region, that saves ~30–50 ms one-way. With players near
  the server and far from each other, it saves little or nothing. Internet paths aren't
  metric, and Valve notes relays are sometimes _faster_ (SDR docs). **This is illustrative,
  not measured.** Measure with telemetry.
- **Head-of-line stalls:** on each lost packet, TCP freezes all remote cars for roughly
  2×RTT to 200+ ms (§1), and the unreliable channel eliminates that. This is a **p95/p99 win**,
  most visible on Wi-Fi and mobile, and it is the most reliable benefit. It also lets us
  **shrink the interpolation buffer** on direct pairs, which is where most of the perceptible
  gain would come from.
- It does **not** help TURN-relayed pairs much, and TURN over TCP not at all.

**Is a full P2P rebuild worth it? No.** It would remove the server's live pose view, force
a signaling-plus-TURN dependency onto every Room, expose IPs by default, and add a failure
mode ("my friend's NAT") in exchange for tens of milliseconds, while still needing the server
for everything that matters (leaderboard, Replays, Rooms). **The hybrid dual-path design
captures almost all of the latency benefit** for about 300–500 lines of client code, one
signaling message type, zero runtime dependencies, one devDependency, and no mandatory new
infrastructure.

**Order of work** (cheapest first):

1. Add pose-age and RTT telemetry on the current relay, so the baseline is known.
2. Switch to binary 40-byte poses and tune the interpolation buffer. This also halves relay
   bytes ([best-tech-stack-2026 §7](best-tech-stack-2026.md#7-shared-schema-and-serialization)).
3. Add `rtc-signal` forwarding and `PeerLink` (raw `RTCPeerConnection`, perfect negotiation,
   negotiated unordered/zero-retransmit channel, dual-path dedupe). Host-only STUN at first
   (Google + Cloudflare), behind a "Direct connections" setting.
4. Add Cloudflare TURN (a server endpoint mints short-TTL `iceServers`) only if telemetry
   shows many pairs stuck on relay **and** relayed-by-TURN pairs beat the WS relay.
5. Consider phase-2 relay suppression only if Railway egress becomes a real cost.

**Not recommended:** PeerJS, Trystero (reliable ordered channel only, and third-party
discovery), simple-peer (unmaintained), geckos.io and WebTransport (both need server UDP,
which Railway lacks), coturn on Railway, and host-authoritative star.

---

## 10. Risks and open questions

- **TURN-need rate for our players is unknown.** Published figures are 2016–2018, from
  video-calling populations. Measure it before paying for anything.
- **The `ondatachannel` reliability-prop quirk** in node-datachannel and werift is a
  reporting bug in the receiver's view. I did not verify whether the wire behaviour is
  affected, because negotiated channels sidestep it. Don't write tests that assert on remote
  channel props.
- **Google STUN terms of use** are unpublished. Keep a second STUN server (Cloudflare) in the
  list.
- **Safari/WebKit** DataChannel behaviour was not exercised here. Only Chromium was tested.
  Baseline 2020 support suggests it's fine (**unverified** empirically).
- **Railway UDP** could change. The docs as of today show only HTTP and TCP-proxy public
  ingress.

---

## Sources

**Specs and standards**

- https://www.w3.org/TR/webrtc/ · https://www.w3.org/TR/webrtc/#dom-rtcicetransportpolicy
- https://www.rfc-editor.org/rfc/rfc8831.html (data channels) · https://www.rfc-editor.org/rfc/rfc8832.html (DCEP) · https://www.rfc-editor.org/rfc/rfc8261.html (SCTP over DTLS) · https://www.rfc-editor.org/rfc/rfc8841.html (max-message-size) · https://www.rfc-editor.org/rfc/rfc8260.html (interleaving)
- https://www.rfc-editor.org/rfc/rfc9260.html (SCTP) · https://www.rfc-editor.org/rfc/rfc6347.html (DTLS 1.2) · https://www.rfc-editor.org/rfc/rfc5288.html (AES-GCM) · https://www.rfc-editor.org/rfc/rfc8446.html (TLS 1.3) · https://www.rfc-editor.org/rfc/rfc6455.html (WebSocket)
- https://www.rfc-editor.org/rfc/rfc8445.html (ICE) · https://www.rfc-editor.org/rfc/rfc8489.html (STUN) · https://www.rfc-editor.org/rfc/rfc8656.html (TURN) · https://www.rfc-editor.org/rfc/rfc8828.html (IP handling)
- https://www.rfc-editor.org/rfc/rfc6298.html (RTO) · https://www.rfc-editor.org/rfc/rfc8985.html (RACK-TLP) · https://github.com/torvalds/linux/blob/master/include/net/tcp.h
- https://datatracker.ietf.org/doc/draft-ietf-mmusic-mdns-ice-candidates/

**MDN / browser / Electron**

- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel
- https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels
- https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
- https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidateStats
- https://chromium.googlesource.com/chromium/src/+/main/content/public/common/content_switches.cc · https://chromium.googlesource.com/chromium/src/+/main/chrome/common/chrome_switches.cc · https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc
- https://webrtc.github.io/webrtc-org/testing/ · https://github.com/webrtc/samples/blob/gh-pages/src/content/peerconnection/trickle-ice/js/main.js
- https://www.electronjs.org/docs/latest/api/web-contents#contentssetwebrtciphandlingpolicypolicy

**Netcode writeups and hybrid precedents**

- https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/ · https://gafferongames.com/post/snapshot_interpolation/
- https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay
- https://dev.epicgames.com/docs/epic-online-services/multiplayer/nat-p2p-interface/p2p-reference · https://dev.epicgames.com/docs/api-ref/enums/eos-e-relay-control

**NAT/TURN statistics**

- https://groups.google.com/g/discuss-webrtc/c/5d_EJwM6iJM · https://medium.com/@fippo/what-kind-of-turn-server-is-being-used-d67dbfc2ff5d (secondary as retrieved)
- https://arxiv.org/abs/2510.27500 · https://arxiv.org/abs/2604.12484

**TURN/STUN providers and hosting**

- https://developers.cloudflare.com/realtime/turn/ · https://developers.cloudflare.com/realtime/turn/generate-credentials/ · https://developers.cloudflare.com/realtime/pricing/
- https://www.metered.ca/stun-turn · https://www.twilio.com/en-us/stun-turn/pricing · https://github.com/coturn/coturn/releases
- https://docs.railway.com/networking/public-networking/specs-and-limits · https://docs.railway.com/networking/tcp-proxy · https://docs.railway.com/networking/private-networking/how-it-works · https://docs.railway.com/pricing/plans

**Libraries** (npm registry + GitHub API, 2026-09-23)

- https://github.com/feross/simple-peer · https://github.com/thaunknown/simple-peer · https://github.com/peers/peerjs (lib/negotiator.ts) · https://github.com/dmotz/trystero (packages/core/src/peer.ts)
- https://github.com/geckosio/geckos.io · https://github.com/rameshvarun/netplayjs
- https://github.com/murat-dogan/node-datachannel (README, src/polyfill) · https://github.com/shinyoshiaki/werift-webrtc · https://github.com/WonderInventions/node-webrtc · https://www.npmjs.com/package/wrtc
- https://github.com/websockets/ws/blob/8.21.3/lib/websocket.js
