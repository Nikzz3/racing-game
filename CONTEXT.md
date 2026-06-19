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
