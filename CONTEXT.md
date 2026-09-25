# Sunset Ridge

A 3D multiplayer racing game. Players join shared rooms to race a circuit, with lap times recorded to a global all-time leaderboard.

## Language

**Track**:
A named racing circuit defined by a closed loop of control points. A Track is chosen at Room creation alongside Difficulty and is fixed for the Room's lifetime. The game is named **Sunset Ridge**; the one circuit currently in the game is **Sunset Ridge Circuit** (slug `sunset-ridge`). These are distinct — "Sunset Ridge" is the product, "Sunset Ridge Circuit" is one Track.
_Avoid_: Map, level, course

**Room**:
A shared race space holding one or more players who race the same Track under the same rules. Both Track and Difficulty are properties of the Room, chosen at creation and fixed for its lifetime.
_Avoid_: Lobby (which is the pre-Room screen, not the race space), session, game

**Lobby**:
The pre-Room screen where a driver sets their identity (name, and their chosen car Variant) and creates or joins a Room. The Lobby is not a Room and holds no race state; its choices persist locally on the driver's device.
_Avoid_: using Lobby to mean Room, menu, title screen

**Variant**:
One of the fixed set of cosmetic car models a driver's car can render as. Purely visual — every Variant shares identical physics under a given Difficulty, and the Variant never affects the leaderboard. Drivers pick one in the Lobby's Garage grid, or keep the default Random state, which re-rolls to a concrete Variant on each connection — the wire only ever carries concrete Variants. A player whose hello carried no Variant renders via the hash-of-player-id fallback.
_Avoid_: car type, skin, model (ambiguous with 3D asset files)

**Difficulty**:
A named set of physics rules (Easy, Medium, Hard) that governs how a car accelerates, how fast it can go, and how harshly going off-road is penalised. Fixed for the lifetime of a Room.
_Avoid_: Mode, level, setting

**Checkpoint**:
One of a Track's ordered gates that a lap must pass through in sequence for the lap to count. Checkpoints enforce _order_ (you cannot skip a gate) but not, by themselves, the racing _line_ — the straight path between two consecutive gates is always legal. A Track that folds back on itself places gates densely enough (on Stormhaven, one per control point) that the required apex-to-apex path _is_ the racing line, so cutting the grass can no longer save time. Checkpoints are invisible gameplay gates, not rendered geometry.
_Avoid_: Gate (informal), waypoint, marker

**Respawn**:
A driver-initiated action that teleports the driver's own car back to the starting position and abandons the lap in progress. Scoped to the requesting driver only — never affects other players in the Room. Preserves the driver's completed lap count and session best lap; persisted leaderboard records are untouched.
_Avoid_: Reset, restart (which imply the whole race or the whole session)

**Track Record**:
The fastest human lap on the leaderboard for a given `(Track, Difficulty)` pair. Set by a real player driving a Plausible Lap in a Room; persisted and segregated per `(Track, Difficulty)`.
_Avoid_: Record (unqualified — collides with the AI Reference Lap), best time

**Plausible Lap**:
A completed lap whose reported trajectory stays within the physical limits of its Room's Difficulty — bounded speed, no teleports. Only Plausible Laps are persisted: an implausible lap still counts within its Room session (HUD, session best), but never becomes a Track Record, Replay, or Pacer. Rejection is silent — the driver is not told (ADR-0005).
_Avoid_: valid lap (collides with checkpoint-order validity, which is a separate, in-Room concept), legal lap, verified lap

**Replay**:
A playback of a recorded, persisted human leaderboard lap for a `(driver, Track, Difficulty)`, fetched from the server and rendered as a single car following a chase camera. The playback interpolates stored poses by timestamp — it does not re-simulate physics.
_Avoid_: Recording, ghost

**Reference Lap**:
The single canonical fastest lap the trained RL policy drives against the real physics — a benchmark answering "how fast can this Track be driven?", not a leaderboard entry. Deterministic (fixed spawn, no stochasticity), computed on demand, never persisted. Shown to players as **"AI Record"**; rendered through the same viewer as a Replay. Only available for Tracks that have a trained policy.
_Avoid_: Record (collides with Track Record), Replay (which is a persisted human lap), ghost

**Pacer**:
An in-Room opponent that plays back a recorded lap's poses live, alongside the driver's own car, sharing the Room's Track and Difficulty. Rendered translucent and non-colliding, with no camera of its own — distinct from a _Replay_, which is a standalone playback following its own chase camera. A Pacer interpolates stored poses by timestamp (it does not re-simulate physics) and never adapts to the driver. Both persisted human _Replays_ and the AI _Reference Lap_ may be surfaced as Pacers: a human Pacer's poses are fetched from the server, while the AI's are baked client-side from the trained policy at selection time and never persisted or ranked (ADR-0006). The AI is offered only where a policy is trained — Sunset Ridge at Medium. A human Pacer renders the Variant recorded with its lap (absent → hash of the recorded driver's name); the AI always drives police, its canonical car.
_Avoid_: ghost, shadow, phantom, rival/opponent (informal)

**Jev**:
TypeSafe's System One model (`jev-latest`), used as a second AI driver alongside the RL policy. Jev never sees pixels or world coordinates: code describes the car and the road ahead in plain English (speed, position on the road, where the road centre lies ahead, the sharpest bend coming up) and Jev answers two Choice questions — brake or accelerate, steer left or right. Code turns the answers into pedals (the pedal Jev picked, full on) and steering (how sure Jev is of its side). The API key stays on the server (ADR-0009). Jev drives Sunset Ridge at Medium only, where its cornering guide was tuned, in its canonical car (`race-future`).
_Avoid_: Jeff, bot, the AI (ambiguous with the RL policy's Reference Lap)

**Jev Lap**:
One lap Jev drove headlessly against the real physics at a fixed decision cadence (one decision per 100 ms of game time), recorded by `npm run jev:record` and bundled with the client together with every decision Jev made. Replayed like a Replay, with Jev's decisions shown alongside. Never a leaderboard entry and never persisted by the server.
_Avoid_: Jev Record (it is not the fastest possible lap, just the recorded one)

**Jev Live Run**:
A lap Jev drives in real time in the player's browser: the client simulates the car and asks the server for Jev's next decision over the WebSocket, one request in flight at a time, judging the pose predicted for when the answer arrives. Network latency varies, so no two runs are the same. Client-only and never persisted; it can be replayed right after it finishes.
_Avoid_: live replay, stream
