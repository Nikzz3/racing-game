# Research: does the wiring for "race a Replay inside a live Room" already exist?

Resolves issue #59 (child of wayfinder map #53). Verifies the claim in issue #27 that
"both halves already exist and just need wiring together" for racing a persisted Replay
inside a live Room. All citations are `path:line` against `origin/master` at 9b2c49e.

## Verdict

The claim is **half true**. The server half genuinely exists: `getReplay` is
room-agnostic and works mid-Room today. The client half does **not** exist in the form
issue #27 describes: `ReplayViewer` is a standalone full-screen viewer with its own
scene, camera, renderer, HUD, and animation loop — it cannot compose into a live Room
scene — and `reference-lap.ts` contains **no rendering code at all** (it only bakes
frames). There is no "non-colliding overlay-car rendering" module anywhere in the client.
The reusable pieces are the frame format, the pose-interpolation math, and the car-mesh
factory; the overlay renderer and all in-Room UI/wiring must be written new.

## Q1 — Can the client issue `getReplay` while inside a live Room?

**Yes, the server side is fully room-agnostic.**

- `server/src/replay.ts:74-85` — `getReplay(name, track, difficulty)` is a pure
  Postgres query keyed on `(name, track, difficulty)`. It takes no `Player` and has no
  concept of Rooms.
- `server/src/index.ts:137-156` — `handleGetReplay` receives the `Player` but never
  reads `player.room`; it just sends back a `replay` or `error` message on the player's
  socket.
- `server/src/index.ts:192-196` — the `getReplay` case in `handleMessage` has no room
  gate (contrast `respawn` at index.ts:180-186, which is explicitly guarded by
  `if (player.room)`).
- `shared/src/messages.ts:122-130` — the wire-format validator for `getReplay` checks
  only `name`/`difficulty`/`track`; no session-state assumption.

Payload note: a replay is sent as a single JSON WebSocket message of up to
`MAX_REPLAY_FRAMES = 6000` frames of 5 rounded numbers (`server/src/replay.ts:5`,
`server/src/index.ts:149-155`) — on the order of 150–250 KB worst case. The 64 KB
`maxPayload` cap (`server/src/index.ts:27,233-236`) applies to **inbound** frames only,
so the response is unaffected. Receiving it mid-race is a one-off burst on the same
socket that carries 20 Hz snapshots; probably fine, but a spec should note it.

## Q2 — Do `ReplayViewer` and `reference-lap.ts` compose into a live Room scene?

**No. Neither piece is what issue #27 says it is.**

### `ReplayViewer` is a standalone viewer, not a composable player

`client/src/game/replay.ts` — the class doc comment itself says "Plays back a recorded
lap in **its own 3D scene** with a chase camera" (replay.ts:11). Concretely it owns:

- its own scene + renderer + camera via `createScene` and its own track mesh build
  (replay.ts:44-46);
- its own full-screen DOM container and REPLAY HUD overlay with an exit button
  (replay.ts:40-42, 51-68);
- its own `requestAnimationFrame` loop and render call (replay.ts:74, 102-103);
- its own chase camera + sun updates (replay.ts:100-101, 141-149);
- wall-clock playback time anchored at construction (`playStart`, replay.ts:21, 83).

None of that can be dropped into the `Game` scene. The genuinely reusable part is the
pose interpolation, `applyFrameAt` (replay.ts:116-139): index-walk over
`ReplayFrame[] = [t, x, z, rot, speed]`, lerp position/speed, shortest-arc heading lerp,
apply to a mesh via `animateCar`. But it is a **private method** entangled with the
viewer's camera/HUD/loop state — it would need extracting.

### `reference-lap.ts` renders nothing

`client/src/game/reference-lap.ts` — the whole file is `buildReferenceLap` plus types:
it runs the RL policy headlessly (`runPolicyLap`, reference-lap.ts:27) and converts the
trajectory to `ReplayFrame[]` (reference-lap.ts:37-43). There is zero Three.js in it.
Playback of the result goes through the exact same standalone `ReplayViewer`
(`client/src/main.ts:44-48`). Issue #27's premise that this file "already renders a
non-colliding overlay car during playback" is **false** — no such overlay renderer
exists in the codebase.

The nearest existing in-scene overlay rendering is `RemotePlayers`
(`client/src/game/remote.ts:13-88`): it adds opaque `createCarMesh` cars to an existing
`scene` and interpolates them from **server snapshots** ~130 ms behind real time
(remote.ts:11). It is a useful structural template (constructor takes the live scene,
`update(dt)` called from the Game loop at `client/src/game/game.ts:160`), but its data
source and timing model are wrong for local replay playback.

"Non-colliding" is trivially true for any added mesh: car–car collision does not exist
in this game at all — the only collision in `CarPhysics` is against track barriers
(`client/src/game/physics.ts:102`). No work needed there, but also nothing to reuse.

### Client routing actively blocks replay-in-Room today

- `client/src/main.ts:25` — `openReplay` starts with `if (game) return;`: a `replay`
  server message that arrives while a `Game` exists is **silently dropped**
  (main.ts:82-83 routes it straight to `openReplay`).
- `getReplay` is only ever sent from the lobby leaderboard's ▶ button
  (`client/src/main.ts:43`, `client/src/ui/lobby.ts:175-176, 222`); there is no in-game
  entry point.

### ADR / glossary position

- `docs/adr/0002-ai-reference-lap-viewer.md:9-10, 18-20` — only the **AI Reference
  Lap** is barred from Rooms ("a *viewer*, not a driver in a Room"; the rejected option
  was running the *policy* live as a Room bot/ghost). Issue #27 is right that a persisted
  human Replay overlay is not covered by that restriction.
- `CONTEXT.md:31-33` — the glossary defines Replay as "rendered as a single car
  following a chase camera", which the new feature changes; the entry (and its and
  Reference Lap's `_Avoid_: ghost` guidance, CONTEXT.md:33,37) should be revisited when
  the feature is specced — the overlay car needs a sanctioned name that isn't "ghost".

## Q3 — Changes a spec must account for

**Protocol: no new messages strictly required.** `getReplay` → `replay`
(`shared/src/messages.ts:46,173`) already carries everything. Two optional items:
(a) selecting "the Track Record replay" currently requires knowing the record holder's
name — the client gets it from leaderboard entries (`hasReplay` + name,
`client/src/ui/lobby.ts:222`), so an in-Room picker can reuse that, but a
"get record replay for (track, difficulty)" convenience message would decouple it;
(b) note the up-to-~250 KB one-shot response size (Q1).

**Server: no changes required.** The handler is already room-agnostic.

**Client architecture — the real work:**

1. **Unblock routing** — `main.ts:25`'s `if (game) return;` guard and the
   `replay`-message dispatch (main.ts:82-83) must fork on "in Game vs in lobby",
   forwarding replay data to the active `Game` instead of dropping it.
2. **New overlay-playback class** — extract `applyFrameAt`'s interpolation
   (replay.ts:116-139) into a component that, like `RemotePlayers`, takes the existing
   `Game` scene, adds one `createCarMesh` car (`client/src/game/car.ts:29`), and is
   ticked from the Game frame loop (`game.ts:147-186`). No camera, no renderer, no HUD,
   no rAF of its own.
3. **Translucent visual treatment must be built** — `createCarMesh` clones the shared
   GLTF model with opaque materials and shadow casting (`car.ts:34-41`); a translucent
   overlay needs per-instance material cloning (`transparent`/`opacity`), probably
   disabled shadows, and a distinct name-tag treatment so it can't be confused with a
   remote player (issue #27 open question).
4. **Lap-anchoring the ghost clock** — `ReplayViewer` anchors playback to wall-clock
   construction time (replay.ts:21). In a Room, "restart each lap" semantics need a
   lap-start anchor; the client's lap timer is server-derived
   (`curLapBaseMs + (now - curLapReceivedAt)`, `game.ts:167,178-182`), so the spec must
   decide whether the overlay starts on the local start-line crossing or the
   server-confirmed one (latency skews the delta display, another #27 open question).
5. **Lifecycle** — dispose the overlay on `left`/`dispose` (`game.ts:227-236`) and on
   respawn (`respawn` resets timing, `main` game keeps running), and define behavior if
   the replay's `track` doesn't match the Room's track (client should guard; server
   doesn't).
6. **Docs** — update `CONTEXT.md`'s Replay entry and coin a term for the overlay car;
   ADR-0002 needs no change but a new ADR/PRD should cite it to keep the AI Reference
   Lap exclusion intact.
