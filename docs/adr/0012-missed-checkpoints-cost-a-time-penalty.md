# A missed Checkpoint costs a time penalty instead of voiding the lap

Partially supersedes ADR-0003.

Until now a missed Checkpoint voided the lap: the server waited for the owed gate
forever, and the client showed a persistent "CHECKPOINT MISSED — Respawn or drive back
through the gate" warning, detected from the car's centerline index against the owed
gate (`client/src/game/checkpoint-miss.ts`). With Stormhaven gating every control point
(ADR-0003), one clipped apex threw away the whole lap and forced a Respawn or a drive
back up the road.

We decided that **a missed Checkpoint costs a flat 2-second Checkpoint Penalty**
(`CHECKPOINT_PENALTY_MS` in `shared/`) and the lap carries on. Lap time is driven time
plus penalties.

## Decision

- **Detection is server-side**, in `server/src/timing.ts` via the shared
  `reachedCheckpoint` (`shared/src/checkpoint.ts`). On each position report the server
  searches from the owed gate forward for the first gate the car is inside; every gate
  jumped over is missed and adds 2 s to the lap in progress. The search stops at the
  start/finish gate (it never looks into the next lap) and never looks more than half a
  lap of gates ahead, so reversing past the start line or driving backwards cannot
  "reach" a gate. Feedback therefore arrives when the car reaches the next gate, not
  the instant it passes the missed one.
- **The start/finish gate cannot be missed.** Besides its normal 8 m radius it also
  counts once the car is past its line anywhere out to the barriers (13 m from the
  centerline; physics keeps cars within 11.8 m). On the road the radius is entered
  before the line, so on-road lap timing is unchanged and existing records stay
  comparable.
- **A penalized lap is an ordinary lap.** It counts toward session best and is persisted
  to the leaderboard (Track Record, Replay, Pacer) with the penalty baked into its time.
  The plausibility lap-time floor (ADR-0005) is judged on the driven time, so penalties
  cannot pad a fabricated lap over the floor.
- **In a Race or Knockout the penalty runs the driver's race clock behind**
  (`server/src/race.ts`). Races rank by elapsed time, not lap times, so without this,
  cutting would be free there. A completed lap counts toward the race only once the
  penalties missed since GO are served. So a penalized car finishes at its crossing
  time plus penalties, and in a Knockout it can be knocked out by a clean car that
  completed the lap during its penalty. Ties on progress go against it by as much.
- **The penalty is published**: the penalty so far this lap rides in each snapshot
  (`PlayerSnapshot.lapPenaltyMs`) and on the `lap` message (`penaltyMs`). The HUD's
  running lap timer includes it. A brief "CHECKPOINT MISSED +2s" flash replaces the
  persistent warning. The flash keys off a session count of missed gates
  (`PlayerSnapshot.missedCheckpoints`), not the lap's penalty. A gate missed on the final
  stretch is charged and cleared in the same update that completes the lap, and the
  `lap` message trails the snapshots (it waits for the leaderboard write). So only a
  count that never resets reports every miss exactly once.

## Considered options

- **Keep voiding the lap (rejected):** punishing out of proportion to the mistake, and
  the only remedies — Respawn or driving back to the gate — both throw away the run.
- **Detect misses from the car's centerline progress (rejected):** on folded Stormhaven
  an off-road car snaps to a nearby section's centerline and would be falsely penalized
  for many gates at once. Reaching a later gate's radius is only possible on that
  section's road, so gate-reach detection cannot be fooled the same way.
- **Treat a missed start line like any other gate (rejected):** a start line counted as
  crossed late would start the next lap further down the road, letting a driver buy a
  faster best lap for 2 s.
- **Keep penalized laps Room-only (rejected):** a product choice; treating them as
  ordinary laps is also simpler — no second class of lap to carry through persistence.
- **A flat penalty per missed gate, detected server-side (chosen).**

## Consequences

- **Cutting is priced, not forbidden** (supersedes ADR-0003's "gross cuts become
  invalid"). With Stormhaven's dense gates a gross cut skips several gates and pays 2 s
  for each; a cut that skips a single gate pays off only if it saves more than 2 s.
  Accepted, and a risk to revisit if such cuts turn out profitable.
- **A penalized Replay or Pacer finishes early.** Its frames are the raw drive, so the
  playback crosses the line ahead of its listed time by the penalty.
- **Respawn is unchanged** — still a driver-initiated action that abandons the lap and
  clears its penalty — but it is no longer the remedy for a missed gate.
- **The headless AI harness stays strict** (`client/src/game/harness.ts`
  `CheckpointTracker`): an AI lap that misses a gate never completes, because the
  Reference Lap is a benchmark of clean driving.
