# Sunset Ridge

A 3D multiplayer racing game. Players join shared rooms to race a single track, with lap times recorded to a global all-time leaderboard.

## Language

**Room**:
A shared race space holding one or more players who race the same track under the same rules. Difficulty is a property of the Room, chosen at creation and applied to every player who joins.
_Avoid_: Lobby, session, game

**Difficulty**:
A named set of physics rules (Easy, Medium, Hard) that governs how a car accelerates, how fast it can go, and how harshly going off-road is penalised. Fixed for the lifetime of a Room.
_Avoid_: Mode, level, setting

**Respawn**:
A driver-initiated action that teleports the driver's own car back to the starting position and abandons the lap in progress. Scoped to the requesting driver only — never affects other players in the Room. Preserves the driver's completed lap count and session best lap; persisted leaderboard records are untouched.
_Avoid_: Reset, restart (which imply the whole race or the whole session)

**Track Record**:
The fastest human lap on the leaderboard for a given Difficulty. Set by a real player driving a valid lap in a Room; persisted and segregated per Difficulty.
_Avoid_: Record (unqualified — collides with the AI Reference Lap), best time

**Replay**:
A playback of a recorded, persisted human leaderboard lap for a `(driver, Difficulty)`, fetched from the server and rendered as a single car following a chase camera. The playback interpolates stored poses by timestamp — it does not re-simulate physics.
_Avoid_: Recording, ghost

**Reference Lap**:
The single canonical fastest lap the trained RL policy drives against the real physics — a benchmark answering "how fast can this track be driven?", not a leaderboard entry. Deterministic (fixed spawn, no stochasticity), computed on demand, never persisted. Shown to players as **"AI Record"**; rendered through the same viewer as a Replay.
_Avoid_: Record (collides with Track Record), Replay (which is a persisted human lap), ghost
