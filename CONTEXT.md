# Sunset Ridge

A 3D multiplayer racing game. Players join shared rooms to race a circuit, with lap times recorded to a global all-time leaderboard.

## Language

**Track**:
A named racing circuit defined by a closed loop of control points. A Track is chosen at Room creation alongside Difficulty and is fixed for the Room's lifetime. The game is named **Sunset Ridge**; the one circuit currently in the game is **Sunset Ridge Circuit** (slug `sunset-ridge`). These are distinct — "Sunset Ridge" is the product, "Sunset Ridge Circuit" is one Track.
_Avoid_: Map, level, course

**Room**:
A shared race space holding one or more players who race the same Track under the same rules. Both Track and Difficulty are properties of the Room, chosen at creation and fixed for its lifetime.
_Avoid_: Lobby, session, game

**Difficulty**:
A named set of physics rules (Easy, Medium, Hard) that governs how a car accelerates, how fast it can go, and how harshly going off-road is penalised. Fixed for the lifetime of a Room.
_Avoid_: Mode, level, setting

**Checkpoint**:
One of a Track's ordered gates that a lap must pass through in sequence for the lap to count. Checkpoints enforce *order* (you cannot skip a gate) but not, by themselves, the racing *line* — the straight path between two consecutive gates is always legal. A Track that folds back on itself places gates densely enough (on Stormhaven, one per control point) that the required apex-to-apex path *is* the racing line, so cutting the grass can no longer save time. Checkpoints are invisible gameplay gates, not rendered geometry.
_Avoid_: Gate (informal), waypoint, marker

**Respawn**:
A driver-initiated action that teleports the driver's own car back to the starting position and abandons the lap in progress. Scoped to the requesting driver only — never affects other players in the Room. Preserves the driver's completed lap count and session best lap; persisted leaderboard records are untouched.
_Avoid_: Reset, restart (which imply the whole race or the whole session)

**Track Record**:
The fastest human lap on the leaderboard for a given `(Track, Difficulty)` pair. Set by a real player driving a valid lap in a Room; persisted and segregated per `(Track, Difficulty)`.
_Avoid_: Record (unqualified — collides with the AI Reference Lap), best time

**Replay**:
A playback of a recorded, persisted human leaderboard lap for a `(driver, Track, Difficulty)`, fetched from the server and rendered as a single car following a chase camera. The playback interpolates stored poses by timestamp — it does not re-simulate physics.
_Avoid_: Recording, ghost

**Reference Lap**:
The single canonical fastest lap the trained RL policy drives against the real physics — a benchmark answering "how fast can this Track be driven?", not a leaderboard entry. Deterministic (fixed spawn, no stochasticity), computed on demand, never persisted. Shown to players as **"AI Record"**; rendered through the same viewer as a Replay. Only available for Tracks that have a trained policy.
_Avoid_: Record (collides with Track Record), Replay (which is a persisted human lap), ghost
