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

**Sector**:
One of three ordered subdivisions of a lap, defined by checkpoint boundaries: S1 spans checkpoints 0–3, S2 spans 4–7, S3 spans 8–11. Inherits the lap's in-order checkpoint validation — cutting the track cannot skip a Sector.
_Avoid_: Section, segment (which leak from non-racing UX)

**Sector Split**:
The time elapsed inside one Sector during a lap. Three per lap; their sum equals the lap time. Persisted on the driver's PB row per Difficulty and used as the comparison baseline for live deltas during subsequent laps.

**Reference Lap**:
The lap whose Sector Splits are compared against during a live lap. Two are tracked per driver per Difficulty: the driver's own PB and the current Track Record (TR). Both are snapshotted at the driver's lap start — a TR set by another player mid-lap does not take effect until the next lap begins. When the driver is the TR holder, only the PB delta is shown (they would be identical).
_Avoid_: Ghost lap (implies a visible competing car; we only compare numbers)
