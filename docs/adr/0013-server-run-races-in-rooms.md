# The server runs Races in Rooms, ranking grid Pacers from their recordings

Partially supersedes ADR-0004, for Pacers on a Race's Grid only.

A Room used to be free driving only: each driver timed their own laps, the server timing
them from client-reported positions (ADR-0005), and a Pacer was a driver-local overlay
(ADR-0004). Issue #171 adds **Races** (see `CONTEXT.md`: Race, Knockout, Grid, Spectator),
with positions, a winner and, in a Knockout, eliminations, which every driver in the Room
must see the same way.

## Decision

- **Called ad hoc, one at a time.** Any driver in a Room calls a Race or a Knockout from the
  HUD whenever the Room has none running or is showing results. Nothing is chosen at Room
  creation; the Lobby and the `rooms` table are unchanged.
- **The server runs it.** A per-Room state machine (countdown → racing → results → free
  driving) seats the Grid, holds entrants on it for the 3 s countdown, and decides positions,
  finishes, eliminations, DNFs and the grace and results timers. It broadcasts the state
  (`race`) whenever it changes. Positions are laps, then next Checkpoint, from the existing
  server timing, ties going to whoever got there first. Checkpoint progress is ignored until
  GO, so nobody can jump the start.
- **The server picks the grid Pacers and ranks them from their recordings.** Empty slots, up
  to six cars, take the fastest human Replays on the Room's `(Track, Difficulty)` board,
  skipping any under an entrant's own name, and every client in the Room gets their frames
  once per race (`racePacers`). A grid Pacer drives its lap from the line at GO and loops it,
  so its progress is fixed by the recording: lap k completes at GO + k × lap time, and its
  Checkpoint times come from `pacerCheckpointTimes`. The server ranks it by the same rule as
  a driver without receiving or simulating anything.
- **Non-racers are Spectators.** A driver in the Room who is not racing in the current race
  (joined mid-race, finished, out) has no car; their camera follows the leader and cycles
  through the cars still racing. The server ignores any state a Spectator still sends until
  the race is over, so a Spectator's lap can never be timed or reach the leaderboard.

## Considered options

- **Client-computed positions (rejected):** each client would rank from its own interpolated
  snapshots, so two drivers could disagree on the order, and on who won or was knocked out.
  Outcomes need one authority, and the server already owns lap and Checkpoint timing.
- **Non-racers keep driving as translucent ghosts (rejected, for Spectators):** a third kind
  of car on the track (neither racing nor a Pacer) whose laps would still be timed while the
  race runs. A Spectator leaves the track to the cars in the race, and "ghost" stays an
  avoided word.
- **The AI Record on the Grid (deferred):** its lap is baked client-side from the policy
  (ADR-0006). To seat and rank it, the server would have to run the policy and the physics
  itself, or trust a client's bake. Grid Pacers are human Replays only; ADR-0006 stands
  unchanged.
- **Format chosen at Room creation (rejected):** a Lobby field and a `rooms` column, and a
  Room locked to one format. Calling races ad hoc lets one Room alternate free driving,
  Races and Knockouts with no Lobby or database change.
- **A server-run race, grid Pacers ranked from their recordings (chosen).**

## Consequences

- **ADR-0004's "driver-local overlay: nothing is broadcast, no server or protocol changes"
  no longer holds for grid Pacers.** The server chooses them, broadcasts their frames, and
  ranks them in race results. They stay translucent and non-colliding (ADR-0008), write
  nothing, and never appear on the leaderboard. The Lobby-armed Pacer keeps ADR-0004 as
  written, except that it is paused during a race.
- **Still no server simulation (ADR-0005).** Drivers progress through client-reported
  positions, so race order is exactly as trustworthy as lap timing already is; Pacers
  progress through their recordings.
- **Calling a race teleports every entrant to the Grid.** The server resets their lap
  progress and advances their spawn counters, as a Respawn does, so clients read the move as
  a teleport, not motion. Race laps count from GO.
- **Respawn keeps its rule mid-race** (lap in progress abandoned, completed laps kept), so it
  cannot gain a place; it returns the car to its own Grid slot and is unavailable during the
  countdown and to Spectators.
- **Leaving the Room mid-race is a DNF.** When no driver is still racing, the Pacers still
  racing are resolved at once from their recordings rather than waited out. Results show for
  10 s, then everyone respawns at the normal spawn.
- **The leaderboard is unchanged.** A race lap is a lap: every Plausible Lap persists as
  before (ADR-0001, ADR-0005). A race itself is Room state in the server's memory and is
  never persisted.
