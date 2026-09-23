# Direct Links carry car poses alongside the server relay

We looked at replacing the client-server model with peer-to-peer networking
([research](../research/peer-to-peer-networking.md)) and kept the server. Drivers in a Room
now also open **Direct Links**: a full mesh of WebRTC data channels that carry only car poses.
Every pose still goes to the server exactly as before, because the server times laps, checks
plausibility (ADR-0005) and records Replays from that stream. The server also relays the WebRTC
negotiation between members of the same Room, and it still relays every pose in its snapshots.

Each pose carries a **stamp**: a sequence number, the sender's own clock, and a respawn epoch.
Receivers merge the relayed copy and the Direct Link copy of a car into one buffer by sequence
number, and draw whichever copy landed first. A car is drawn on the sender's clock, 80 ms behind
its fastest path while its Direct Link delivers the newest poses first, and 130 ms behind
otherwise. That test counts poses, not wall time, so a client drawing only a few frames a
second, whose messages arrive in bursts, still recognizes a live link. The delay moves
gradually between the two, so a link opening or dropping never makes the car jump. Fallback is
not a mode switch: a pair that cannot link, or whose link drops, keeps getting the relayed
copies.

The channel is pre-agreed (`negotiated`, id 0), unordered and never retransmitted, so a lost
pose is simply replaced by the next one. That avoids TCP head-of-line stalls, which freeze every
remote car on a lossy connection today. The lower player id always makes the offer, so the two
sides never offer at once. Clients use the browser's own `RTCPeerConnection`, with no new runtime
dependency. `node-datachannel` provides a real WebRTC stack for the unit tests.

## Considered options

- **Full peer-to-peer, server only for signaling:** rejected. Lap timing, plausibility and
  Replays all need the server to see every pose at 20 Hz, so the uplink to the server cannot go
  away. Players on old desktop builds, and pairs that cannot connect directly, also need the
  relay.
- **One player hosts the Room (star topology):** rejected. The host's upload carries everyone's
  traffic, and the Room ends when the host leaves.
- **Use Direct Links instead of the relay, switching back on failure:** rejected. It needs
  failure detection and handover logic, and the car glitches at every handover. Sending on both
  paths costs about 150 kbit/s per client in a full eight-car Room.
- **A library** (simple-peer, PeerJS, Trystero, geckos.io): rejected. They are unmaintained, or
  need their own broker, or only open reliable ordered channels, which would give up the latency
  gain.
- **Self-hosted TURN on Railway:** not possible, because Railway has no public UDP ingress.

## Consequences

- **Server load:** the server's traffic and work are unchanged, apart from relaying a few
  signals per pair.
  - A signal only reaches a Room-mate whose client offered Direct Links in its `hello`, and the
    server stamps the real sender.
  - Each driver may send at most 200 signals every 10 s.
- **Old clients:** they keep working in both directions.
  - Clients that predate Direct Links never send `direct` or `stamp` and never get a signal, so
    they are drawn from relayed snapshots timed by arrival, as before.
  - A new client that connects to a server predating Direct Links gets no `iceServers` in
    `joined`, so it never tries to link.
- **Forged poses:** a peer could send different poses over its Direct Link than it reports to
  the server. Three checks limit this:
  - An honest client sends identical values on both paths. If a Direct Link copy of a pose
    differs from the relayed copy, the receiver drops that car's Direct Link poses for the rest
    of the Room.
  - A Direct Link pose is only accepted within 20 poses of the car's newest relayed pose. Its
    clock is not checked: stamps reach the server unchecked too, so the relay path would
    accept the same forgery.
  - The collision rule from ADR-0008 still applies, so an impossible move passes through
    instead of shoving the local car.
  - These poses are only drawn and collided with. They never reach timing or the leaderboard.
- **Privacy:** Direct Links reveal each driver's IP address to the other drivers in the Room.
  They never reveal it to the server's other users. This is a deliberate trade for public
  Rooms; an opt-out setting is a possible follow-up.
- **NAT traversal:** by default the server hands out public STUN servers only (Google and
  Cloudflare). `ICE_SERVERS` overrides the list, for example with Cloudflare TURN
  credentials. Pairs behind NATs that STUN cannot traverse stay on the relay.
- **Room size:** a Room links at most seven peers per client, a full mesh for eight cars.
  Beyond that the extra cars are relayed.
- **Retries:** a link counts as failed if it has not opened within 15 s, or if it closes. The
  offering side then tries again after 5, 10 and 15 s, four attempts in all. A link that drops
  mid-race recovers this way. A pair that NAT keeps apart settles on the relay.
- **Measurement:** we have no telemetry yet on how many pairs link directly, or on how old a
  pose is when drawn. The research recommends measuring both before tuning further.
