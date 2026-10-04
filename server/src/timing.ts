import { CHECKPOINT_PENALTY_MS, reachedCheckpoint, type TrackSample } from "@racing/shared";

/** Server wall-clock time (ms) plus world x/z. */
interface WindowSample {
  t: number;
  x: number;
  z: number;
}

export interface TimingState {
  /** Index of the next checkpoint the player must pass. */
  next: number;
  lapStartT: number | null;
  /** Checkpoint Penalties the lap in progress has collected (ADR-0012). */
  penaltyMs: number;
  /**
   * Checkpoints missed this session. Only grows, so a client can flash each miss
   * however its snapshots and lap messages interleave, even one charged as a lap completes.
   */
  missedCheckpoints: number;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Recent samples of the lap in progress; reset on lap start and Respawn. */
  windowSamples: WindowSample[];
  /** Set once any window violates the speed bound; cleared on lap start and Respawn. */
  lapImplausible: boolean;
  /** Respawns so far; lets clients tell a teleport from movement. */
  spawns: number;
  /** A respawn happened but its position has not arrived yet. */
  spawnPending: boolean;
}

export function createTiming(): TimingState {
  return {
    next: 0,
    lapStartT: null,
    penaltyMs: 0,
    missedCheckpoints: 0,
    laps: 0,
    lastLapMs: null,
    bestLapMs: null,
    windowSamples: [],
    lapImplausible: false,
    spawns: 0,
    spawnPending: false,
  };
}

/**
 * Abandon the lap in progress and rewind to the start line, keeping completed
 * laps, last lap and session best — those already happened.
 */
export function respawnTiming(t: TimingState): void {
  t.next = 0;
  t.lapStartT = null;
  t.penaltyMs = 0;
  t.windowSamples = [];
  t.lapImplausible = false;
  t.spawnPending = true;
}

/**
 * Line up on a race's grid: a Respawn (the client moves the car to its slot)
 * that also clears the completed laps, since race laps count from GO.
 */
export function gridTiming(t: TimingState): void {
  respawnTiming(t);
  t.laps = 0;
}

/** Publish the respawn only once the spawn position is stored, so no snapshot
 * pairs the new counter with the pre-respawn coordinates. */
export function settleSpawn(t: TimingState): void {
  if (!t.spawnPending) return;
  t.spawnPending = false;
  t.spawns++;
}

export interface LapResult {
  /** Driven time plus the lap's Checkpoint Penalties. */
  lapTimeMs: number;
  penaltyMs: number;
  isPersonalBest: boolean;
  /** False when the speed bound or the lap-time floor was violated. */
  isPlausible: boolean;
}

const PLAUSIBILITY_WINDOW_MS = 1000;
/** Headroom over maxSpeedMs for network burst jitter. */
const SPEED_TOLERANCE = 1.1;
/**
 * Floor on the window duration the speed bound is judged over. Samples are
 * stamped on arrival, so two honest updates delivered in the same TCP read land
 * a millisecond apart and would read as hundreds of m/s over that sliver.
 * Mid-lap the window is a full second wide and absorbs that; right after the
 * start-line reset, or after trimming collapsed it, it is not. 250 ms keeps a
 * 0.75 m honest hop at a few m/s while a checkpoint-sized teleport still
 * measures in the hundreds, and young windows are never skipped, so a burst
 * cannot hide behind the lap-start reset.
 */
const MIN_WINDOW_MS = 250;

function exceedsSpeedBound(samples: WindowSample[], now: number, maxSpeedMs: number): boolean {
  if (samples.length < 2) return false;
  let dist = 0;
  for (let i = 1; i < samples.length; i++) {
    dist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  }
  const windowMs = Math.max(now - samples[0].t, MIN_WINDOW_MS);
  return dist / (windowMs / 1000) > maxSpeedMs * SPEED_TOLERANCE;
}

/**
 * Advance checkpoint progress from a reported position and judge plausibility
 * (ADR-0005): the lap is flagged if the path covered in any ~1 s window exceeds
 * `maxSpeedMs × 1.1`, or if its driven time is under `minLapMs`. Both are silent
 * to the client. Reaching a gate past the owed one costs a Checkpoint Penalty
 * for each gate missed on the way (ADR-0012). Returns a result when a lap
 * completes at the start line.
 */
export function updateTiming(
  t: TimingState,
  x: number,
  z: number,
  now: number,
  checkpoints: readonly TrackSample[],
  maxSpeedMs: number,
  minLapMs: number,
): LapResult | null {
  if (t.lapStartT !== null) {
    t.windowSamples.push({ t: now, x, z });
    // Judge before trimming: trimming first can collapse the window to this one
    // sample whenever the gap since the previous sample exceeds the window
    // width, which would let sparse updates teleport any distance per hop.
    if (!t.lapImplausible && exceedsSpeedBound(t.windowSamples, now, maxSpeedMs)) {
      t.lapImplausible = true;
    }
    while (t.windowSamples.length > 1 && now - t.windowSamples[0].t > PLAUSIBILITY_WINDOW_MS) {
      t.windowSamples.shift();
    }
  }

  const reached = reachedCheckpoint(checkpoints, t.next, x, z);
  if (reached === null) return null;
  const missed = (reached - t.next + checkpoints.length) % checkpoints.length;
  t.missedCheckpoints += missed;
  t.penaltyMs += missed * CHECKPOINT_PENALTY_MS;

  let result: LapResult | null = null;
  if (reached === 0) {
    if (t.lapStartT !== null) {
      const drivenMs = now - t.lapStartT;
      const lapTimeMs = drivenMs + t.penaltyMs;
      t.laps += 1;
      t.lastLapMs = lapTimeMs;
      // Judged on driven time, so penalties cannot pad a fabricated lap over the floor.
      const isPlausible = !t.lapImplausible && drivenMs >= minLapMs;
      // An implausible lap is still broadcast to the room but must never become
      // the session best or be advertised as a PB.
      const isPersonalBest = isPlausible && (t.bestLapMs === null || lapTimeMs < t.bestLapMs);
      if (isPersonalBest) t.bestLapMs = lapTimeMs;
      result = { lapTimeMs, penaltyMs: t.penaltyMs, isPersonalBest, isPlausible };
    }
    t.lapStartT = now;
    t.penaltyMs = 0;
    t.lapImplausible = false;
    t.windowSamples = [{ t: now, x, z }];
  }
  t.next = (reached + 1) % checkpoints.length;
  return result;
}
