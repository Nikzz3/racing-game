# Research: can the client-computed AI lap feed the in-Room Pacer overlay?

Resolves issue #65 (child of wayfinder map #63). Question: can `buildReferenceLap`'s
client-side, never-persisted `ReplayFrame[]` feed the same in-Room Pacer
overlay-playback path a human Replay uses, and does anything in #27's decided design
(map #53) assume a server pose-origin? All citations are `path:line` against
`origin/master` at `9b2c49e` unless noted.

## Verdict

**Yes, architecturally.** Nothing decided on map #53 (#59/#55/#54/#56) is coupled to a
server `replay` message or `getReplay` origin — the design already treats the overlay's
data as a plain in-memory `ReplayFrame[]` and its playback clock as fully client-local.
The one real constraint is **track/difficulty matching** (#54), and `buildReferenceLap`
is hardcoded to Sunset Ridge + Medium, so an AI Pacer would only be valid in Sunset
Ridge/Medium Rooms without further generalization work. **#60 is not a prerequisite**
for nailing down the injection point — it is a spec-assembly/relabeling step over
decisions that are already closed and sufficient; but the overlay-playback class itself
does not exist in the codebase yet regardless of source.

## 1. The AI pose stream: shape, and client-only/on-demand/hardcoded nature

`buildReferenceLap` (`client/src/game/reference-lap.ts:26-46`):

```ts
export function buildReferenceLap(policy: PolicyWeights): ReferenceLap | null {
  const result = runPolicyLap(policy, { track: SUNSET_RIDGE });   // line 27
  ...
  const frames: ReplayFrame[] = lapTrajectory.map((s, i) => [
    i * DT_MS, round(s.x, 2), round(s.z, 2), round(s.heading, 3), round(s.speed, 2),
  ]);                                                              // lines 37-43
  return { name: 'AI Record', track: SUNSET_RIDGE.id, timeMs: result.lapTimeMs, frames };
}
```

- **Type**: `ReplayFrame = [number, number, number, number, number]` (`t, x, z, rot,
  speed`) — defined once in `shared/src/messages.ts:38` and reused for the server's
  `replay` message payload (`shared/src/messages.ts:173`: `{ type: "replay"; ...;
  frames: ReplayFrame[] }`). **The AI stream and a human Replay's stream are the exact
  same wire/in-memory type.**
- **Client-only, on demand**: `runPolicyLap` (`harness.ts:221-255`) runs the exported
  MLP policy (`policyForward`, harness.ts:200-215) against the real `CarPhysics` purely
  in the browser, synchronously, whenever `buildReferenceLap` is called — no network
  call, no server round-trip. It is invoked from the lobby "AI Record" button
  (`client/src/main.ts:44-48` per #59's findings) and never sent anywhere; nothing in
  `reference-lap.ts` or `harness.ts` touches a WebSocket or the leaderboard DB.
- **Hardcoded to Sunset Ridge**: `runPolicyLap(policy, { track: SUNSET_RIDGE })`
  (reference-lap.ts:27) — the `track` option is set explicitly, not inherited from Room
  state.
- **Hardcoded to Medium physics**: `runPolicyLap`'s `options.difficulty` defaults to
  `'medium'` (harness.ts:225) and `reference-lap.ts` never overrides it. Confirmed by
  ADR-0002: "**Medium only.** The policy hardcodes `MEDIUM_MAX_SPEED` for observation
  normalization and was trained/validated on Medium alone"
  (`docs/adr/0002-ai-reference-lap-viewer.md:23-25`).
- **Never persisted**: no DB write anywhere in `reference-lap.ts`/`harness.ts`; ADR-0002
  confirms this is deliberate ("Client-only standalone Reference Lap viewer (chosen):
  computed on demand ..., never persisted", ADR-0002 lines ~19-21).

## 2. The human-Pacer wiring decided on map #53

**The overlay-playback class does not exist in the codebase yet** (confirmed: no
`Pacer`/`pacer` hits anywhere under `client/src`, `server/src`, `shared/src`,
`CONTEXT.md`, or `docs/adr`; only the *name* landed, via PR #62 for #58). What exists
today, per `client/src/game/replay.ts` and the wiring research on
`research/replay-in-room-wiring` (`docs/research/replay-in-room-wiring.md`, resolving
#59), is:

- **`ReplayViewer`** (`client/src/game/replay.ts`) — a standalone full-screen viewer
  with its own scene/camera/renderer/HUD/`requestAnimationFrame` loop
  (replay.ts:11-21, 74). It cannot compose into the live `Game` scene. Its one reusable
  piece is the private `applyFrameAt` method (replay.ts:116-139): index-walks
  `this.frames: ReplayFrame[]`, lerps `x/z/speed`, does shortest-arc heading lerp, and
  applies the pose via `animateCar` to a `carMesh` built by `createCarMesh`
  (`client/src/game/car.ts:29`). It operates purely on the in-memory `frames` array —
  it has no awareness of where those frames came from.
- **`RemotePlayers`** (`client/src/game/remote.ts:13-88`) is the *structural template*
  #59 points to for the new class: it takes the live `scene` and a player id in its
  constructor, adds `createCarMesh` cars to that scene, and is ticked via `update(dt)`
  called from `game.ts`'s frame loop (`game.ts:160` per #59's findings) — no camera, no
  HUD, no rAF of its own. (Its own data source, server snapshots, is *not* what the new
  class should copy — see below.)

**Issue #59's resolution** (quoted): "the client half does not [exist]... `reference-lap.ts`
renders nothing — it only bakes `ReplayFrame[]` from the RL policy; the
'non-colliding overlay-car rendering' cited in #27 does not exist anywhere... Client
work: fork the `replay`-message routing on in-Game vs lobby; build a new
overlay-playback class (extracted interpolation + `createCarMesh` in the Game scene,
ticked from the Game loop)."

**Issue #55's resolution (playback lifecycle — quoted in full, the key excerpt):**

> **2. Lifecycle: lap-anchored restart.** The Replay restarts from frame zero every
> time the driver's lap starts. Not a continuous loop, not on-demand playback.
> **3. Anchor: local crossing detection.** The restart triggers on the
> client-detected start-line crossing, using the shared checkpoint geometry from
> `shared/src/track.ts` — not the server-confirmed lap start. The overlay is
> authoritative for nothing, and waiting for the server would offset the ghost by the
> driver's ping on a ~24 s lap, systematically flattering the driver.

This is the strongest evidence against server-origin coupling: the *playback clock
itself* is explicitly designed to be client-local, deliberately rejecting a
server-confirmed anchor. Nothing about "restart on local start-line crossing" cares
whether `frames` arrived via `getReplay` or was computed by `buildReferenceLap`.

**Issue #54's resolution (selection scope — quoted, the operative constraint):**

> **1. Scope: any leaderboard entry.** Any of the top-10 rows whose `hasReplay` is true
> can be loaded as the in-Room opponent... **3. Matching: the Replay must match the
> Room's track *and* difficulty.** Selection is limited to the leaderboard the lobby
> already shows for that pair.

This is a *data-acquisition/selection* rule about which human `getReplay` result to
fetch — not a constraint baked into the overlay-playback class's input contract. It
does, however, establish the one real compatibility rule an AI-sourced feed would also
need to satisfy: **track + difficulty must match the Room**. Since
`buildReferenceLap` is fixed to Sunset Ridge + Medium (see §1), an AI Pacer would need
either a Room-side guard or per-track/difficulty policies before it could go beyond
those two conditions — a scoping gap, not an architectural one.

**Issue #56's resolution (visual treatment — quoted, relevant excerpt):** "the overlay
Replay car = translucent phantom (variant A)... `transparent: true`, `depthWrite:
false` on the car materials... `REPLAY` pill badge... Feeds the visuals section of the
consolidated spec in #27 (assembled by #60)." This decision is about the mesh/material
applied to whatever `carMesh` the class drives — it is agnostic to pose-stream origin.
The `worktree-wayfinder-overlay-car-prototype` branch (`client/src/prototype-overlay-car.ts`,
commit `211a35a`) is a standalone throwaway Vite fixture comparing three treatments; it
does not touch `game.ts`/`main.ts` wiring and adds no new architectural facts beyond
#59's findings.

## 3. The injection point, and the server-origin coupling question

**Injection point**: the future overlay-playback class (not yet written; the natural
home is a new file mirroring `remote.ts`'s shape) will be constructed/updated with
exactly the fields `ReferenceLap` already exposes:

```ts
// reference-lap.ts:12-17
export interface ReferenceLap {
  name: 'AI Record';
  track: TrackSlug;
  timeMs: number;
  frames: ReplayFrame[];
}
```

That is structurally identical to the payload of the server's `replay` message
(`shared/src/messages.ts:173`: `{ name, track, timeMs, frames: ReplayFrame[] }`, modulo
the `type` discriminant). The class's actual playback engine — the extracted
`applyFrameAt` logic from `replay.ts:116-139` — consumes only `frames: ReplayFrame[]`
plus a `t`; it has and needs no reference to `getReplay`, sockets, or a `Player`.

**Coupling check, ticket by ticket:**

- **#59** (wiring): explicitly names both `frames: ReplayFrame[]` and the fact that
  `reference-lap.ts` already produces that exact shape client-side as the reusable
  asset — no server-origin assumption stated or implied.
- **#55** (lifecycle): the restart anchor is *client-detected* start-line crossing via
  `shared/src/track.ts` geometry, explicitly **not** server-confirmed — actively
  designed away from a server pose-origin.
- **#54** (selection scope): the only origin-adjacent language is about `getReplay`
  being keyed `(name, track, difficulty)` with "zero change" needed — this describes
  how a *human* Replay's frames are fetched, not a requirement that frames arrive via
  the network. It does not gate the overlay class on message origin, only on track+
  difficulty match.
- **#56** (visuals): no data-source assumption; purely about the mesh/material once a
  car exists in the scene.

**No ticket assumes a server pose-origin.** The overlay-playback class's real input
contract is "a `ReplayFrame[]` (+ track/timeMs) already sitting in the client," which
`buildReferenceLap` already produces. A client-computed AI lap could be injected at the
same seam a fetched human Replay's `frames` would be — the class doesn't need to know
or care which one it got. The `getReplay`/`replay` message is exclusively the
*acquisition* mechanism for human Replays (because their frames live server-side in
Postgres, `server/src/replay.ts:74-85`); the AI Reference Lap has no equivalent
acquisition step because it's computed, not stored, so it would skip that message
entirely and hand `frames` straight to the overlay class's constructor/update path.

**What would still need deciding** for an actual AI-Pacer effort (not blocking the
injection-point answer, but real scoping gaps): (a) Sunset Ridge/Medium hardcoding in
`reference-lap.ts`/`harness.ts` vs. #54's track+difficulty matching rule; (b) ADR-0002
only sanctions *baked-pose, non-live* AI playback in a viewer — its rejected option was
"run the policy live as a Room bot/ghost" (ADR-0002, "Considered Options"), so an
AI Pacer would need to stay in the same baked/computed-once mold `buildReferenceLap`
already uses, not switch to live in-Room inference; #58's Pacer definition already
anticipates this ("the AI's baked-pose lap *could* mechanically be a Pacer... only human
Replays are surfaced as Pacers today").

## 4. Is #60 a prerequisite?

**No.** #60's body: "Once all decisions are in: write the consolidated spec into #27
(selection scope, lifecycle, visuals, HUD, name, wiring notes), swap `needs-info` for
`ready-for-agent`, and close out the map." It is a transcription/relabeling step over
decisions already closed on map #53 — it introduces no new design content. All four
decision tickets in scope for this question (#59, #55, #54, #56) are already resolved
and, per §3, already answer the coupling question without ambiguity: none of them ties
the overlay's input contract to a server origin. #60 gates *when Sandcastle is allowed
to start building the class* (via the `ready-for-agent` relabel), not whether the
injection point can be identified — which this document does now, ahead of #60.

The one genuinely open item is unrelated to server-origin coupling: map #53's "Not yet
specified" section flags whether the decided Replay-in-Room boundary needs a new/amended
ADR — orthogonal to whether a client-computed feed can drive the same class.
