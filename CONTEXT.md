# Sunset Ridge

A 3D multiplayer racing game. Players join shared rooms to race a circuit, with lap times recorded to a global all-time leaderboard.

## Language

**Track**:
A named racing circuit defined by a closed loop of control points, stored in `shared/src/tracks/<slug>.json` and drawn in Blender (ADR-0015). A Track is chosen at Room creation alongside Difficulty and is fixed for the Room's lifetime. The game is named **Sunset Ridge**; its Tracks are **Sunset Ridge Circuit** (slug `sunset-ridge`), **Stormhaven Circuit** and **Arrowhead Raceway**. "Sunset Ridge" is the product, "Sunset Ridge Circuit" is one Track.
_Avoid_: Map, level, course

**Room**:
A shared race space holding one or more players who race the same Track under the same rules. Both Track and Difficulty are properties of the Room, chosen at creation and fixed for its lifetime. A Daily Room is the exception: the date, not its creator, picks them. A Room holds at most one Race at a time; the rest of the time its drivers are free driving, each timing their own laps.
_Avoid_: Lobby (which is the pre-Room screen, not the race space), session, game

**Lobby**:
The pre-Room screen where a driver sets their identity (name, and their chosen car Variant) and creates or joins a Room. The Lobby is not a Room and holds no race state; its choices persist locally on the driver's device.
_Avoid_: using Lobby to mean Room, menu, title screen

**Variant**:
One of the fixed set of cosmetic car models a driver's car can render as. Purely visual — every Variant shares identical physics under a given Difficulty, and the Variant never affects the leaderboard. Drivers pick one in the Lobby's Garage grid. Four Variants are free; each of the others unlocks once the driver's best Medal on any `(Track, Difficulty)` reaches its tier, so a driver can never drive a locked Variant. First-time visitors start on the first free Variant. In a Daily Room every driver drives the Daily Challenge's Variant instead, which is always a free one. A player whose hello carried no Variant renders via the hash-of-player-id fallback.
_Avoid_: car type, skin, model (ambiguous with 3D asset files)

**Difficulty**:
A named set of physics rules (Easy, Medium, Hard) that governs how a car accelerates, how fast it can go, and how harshly going off-road is penalised. Fixed for the lifetime of a Room.
_Avoid_: Mode, level, setting

**Checkpoint**:
One of a Track's ordered gates that a lap passes through in sequence. Missing one costs a Checkpoint Penalty; the lap carries on (ADR-0012). Checkpoints enforce _order_ but not, by themselves, the racing _line_ — the straight path between two consecutive gates is always legal. A Track that folds back on itself places gates densely enough (on Stormhaven, one per control point) that the apex-to-apex path _is_ the racing line, so a cut that skips gates pays for each. The start/finish gate cannot be missed: it also counts once the car is past its line anywhere out to the barriers. Checkpoints are invisible gameplay gates, not rendered geometry.
_Avoid_: Gate (informal), waypoint, marker

**Checkpoint Penalty**:
The flat 2 seconds added to the lap in progress for each Checkpoint the car skips. Detected by the server when the car reaches a later gate, so it lands then, not the instant the gate is passed. A penalized lap is otherwise an ordinary lap — lap time is driven time plus penalties, and it counts toward session best and the leaderboard with the penalty baked in. In a Race or Knockout it runs the driver's race clock behind: a completed lap counts only once the penalty is served. Cleared by Respawn along with the lap.
_Avoid_: time penalty (unqualified — collides with the off-road grass penalty), DNF, invalid lap

**Respawn**:
A driver-initiated action that teleports the driver's own car back to the starting position and abandons the lap in progress. Scoped to the requesting driver only — never affects other players in the Room. Preserves the driver's completed lap count and session best lap; persisted leaderboard records are untouched. In a Race the car goes back to its own Grid slot instead; the lap in progress is still abandoned, so a Respawn can never gain a place. It is unavailable during the countdown and to Spectators.
_Avoid_: Reset, restart (which imply the whole race or the whole session)

**Track Record**:
The fastest human lap on the leaderboard for a given `(Track, Difficulty)` pair. Set by a real player driving a Plausible Lap in a Room; persisted and segregated per `(Track, Difficulty)`.
_Avoid_: Record (unqualified — collides with the AI Reference Lap), best time

**Plausible Lap**:
A completed lap whose reported trajectory stays within the physical limits of its Room's Difficulty — bounded speed, no teleports. Only Plausible Laps are persisted: an implausible lap still counts within its Room session (HUD, session best), but never becomes a Track Record, Replay, or Pacer. Rejection is silent — the driver is not told (ADR-0005).
_Avoid_: valid lap (suggests a missed Checkpoint invalidates a lap; it only costs a Checkpoint Penalty), legal lap, verified lap

**Replay**:
A playback of a recorded, persisted human leaderboard lap for a `(driver, Track, Difficulty)`, fetched from the server and rendered as a single car following a chase camera. The playback interpolates stored poses by timestamp — it does not re-simulate physics.
_Avoid_: Recording, ghost

**Reference Lap**:
The single canonical fastest lap the trained RL policy drives against the real physics — a benchmark answering "how fast can this Track be driven?", not a leaderboard entry. Deterministic (fixed spawn, no stochasticity), computed on demand, never persisted. Shown to players as **"AI Record"**; rendered through the same viewer as a Replay. Only available for Tracks that have a trained policy.
_Avoid_: Record (collides with Track Record), Replay (which is a persisted human lap), ghost

**Pacer**:
An in-Room opponent that plays back a recorded lap's poses live, alongside the driver's own car, sharing the Room's Track and Difficulty. Rendered translucent and non-colliding, with no camera of its own — distinct from a _Replay_, which is a standalone playback following its own chase camera. A Pacer interpolates stored poses by timestamp (it does not re-simulate physics) and never adapts to the driver. Both persisted human _Replays_ and the AI _Reference Lap_ may be surfaced as Pacers: a human Pacer's poses are fetched from the server, while the AI's are baked client-side from the trained policy at selection time and never persisted or ranked (ADR-0006). The AI is offered only where a policy is trained — Sunset Ridge at Medium. A human Pacer renders the Variant recorded with its lap (absent → hash of the recorded driver's name); the AI always drives police, its canonical car. A Pacer a driver arms in the Lobby is theirs alone and is paused during a Race; Pacers on a Race's Grid are chosen by the server, seen by everyone in the Room, and ranked in the Race's results like drivers — never on the leaderboard (ADR-0014).
_Avoid_: ghost, shadow, phantom, opponent (informal); rival, except for the Pacer the Rival ladder offers (see **Rival**)

**Medal**:
One of four tiers a driver's best lap can earn on a `(Track, Difficulty)`: Bronze, Silver, Gold and Author, from easiest to hardest. Each tier is a target lap time: Author is set per `(Track, Difficulty)` (on Sunset Ridge at Medium it is the AI Reference Lap time), and Gold, Silver and Bronze are 106%, 120% and 150% of it. A Medal is never stored: it is read off the driver name's persisted best lap, so only Plausible Laps earn one, and the driver keeps it on any device under the same name (ADR-0012).
_Avoid_: trophy, achievement

**Rival**:
The Pacer the Rival ladder offers next: the slowest lap on a `(Track, Difficulty)` leaderboard that has a Replay, belongs to another driver, and is still faster than the driver's persisted best (or, before their first Plausible Lap there, the slowest such lap). Offered after every lap in a Room and in the Lobby's Pacer picker; beating it advances to the next Rival, so the next target is always just ahead.
_Avoid_: opponent, target, nemesis

**Standing**:
A driver name's place on one `(Track, Difficulty)` leaderboard: their persisted best lap (if any) and their current Rival. Medals, car unlocks and the Rival ladder are all read off a driver's Standings; the server sends them on request and after each of the driver's Plausible Laps.
_Avoid_: profile, stats, progress

**Daily Challenge**:
The one challenge everyone shares on a given UTC day, numbered from Daily #1 on release day: a Track, a Difficulty, a Variant and a Scene Preset, all derived from the date alone. It rolls over at UTC midnight.
_Avoid_: Track of the Day, daily race, daily mode

**Daily Room**:
The single Room in which the current Daily Challenge is raced, shared by every driver who enters it that day. Its Track, Difficulty and Variant are the Daily Challenge's; it closes when the day rolls over.
_Avoid_: Daily lobby, daily session

**Daily Board**:
The fastest Plausible Lap per driver driven in a day's Daily Room, separate from the all-time Track Record board. A daily lap also counts toward the all-time board for its Track and Difficulty (ADR-0013).
_Avoid_: daily leaderboard (fine in prose, but the board is the domain term), daily records

**Scene Preset**:
The look of the world a Room renders: sky, sun, light and fog. Purely visual, like a Variant. A Daily Room renders its Daily Challenge's Scene Preset; every other Room and every Replay render Sunset.
_Avoid_: weather, theme, time of day (one part of the look)

**Race**:
A contest among the cars on a Room's Grid, run by the server: a countdown, racing with live positions, then results, after which the Room returns to free driving. Any driver in the Room may call one when none is running. "Race" also names one of its two formats (first to complete three laps wins, and once the first car finishes the rest have a grace period to follow), the other being a Knockout. A car that leaves the Room mid-race, or misses a Race's grace period, is DNF (did not finish).
_Avoid_: heat, match, session, round

**Knockout**:
The Race format where the last car to complete each lap is out, until the one car still racing wins; it runs one lap fewer than it has cars on the Grid. Once the first car completes a lap the rest have a grace period to complete it, and whoever has not by then is out, several at once if need be.
_Avoid_: elimination race, last man standing

**Grid**:
A Race's starting slots, two abreast behind the starting position. Every driver in the Room when the Race is called takes a slot; the server fills the empty ones, up to six cars, with Pacers from the fastest human Replays on the Room's `(Track, Difficulty)` board.
_Avoid_: lineup, starting line

**Spectator**:
A driver in a Room while a Race is counting down or running who is not racing in it: joined mid-race, finished, knocked out, or DNF. A Spectator has no car; they watch the cars still racing, starting with the leader, and drive again when the Room returns to free driving.
_Avoid_: ghost (implies a car still driving; also avoided for Pacers), observer, viewer

**Jev**:
TypeSafe's System One model (`jev-latest`), used as a second AI driver alongside the RL policy. Jev never sees pixels or world coordinates: code describes the car and the road ahead in plain English (speed, position on the road, where a racing line code computed lies ahead, and code's speed check: whether the car is too fast to make the road ahead, and by how much) and Jev answers two Choice questions — brake or accelerate given the speed check, and steer left, right or nothing (leave the wheel centred) to point at the racing line. Code turns the answers into pedals (the pedal Jev picked, full on) and steering (twice how sure Jev is of its side, 2 · (P(left) − P(right)) clamped, so "nothing" adds no steering). Code does the physics and Jev the judgment, so Jev's pedal mostly follows the speed check (ADR-0011). Jev only drives offline, in `npm run jev:record`: the API key lives in the recording developer's `.env`, and neither the game nor the server talks to TypeSafe (ADR-0010). Jev drives Sunset Ridge at Medium only, where its racing line and speed check were tuned, in its canonical car (`race-future`).
_Avoid_: Jeff, bot, the AI (ambiguous with the RL policy's Reference Lap)

**Jev Lap**:
One lap Jev drove headlessly against the real physics at a fixed decision cadence (one decision per 100 ms of game time), recorded by `npm run jev:record` and bundled with the client together with every decision Jev made. Replayed like a Replay, with Jev's decisions shown alongside. Never a leaderboard entry and never persisted by the server.
_Avoid_: Jev Record (it is not the fastest possible lap, just the recorded one)
