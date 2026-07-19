import { CHECKPOINT_RADIUS } from "@racing/shared";

/** A single position sample: server wall-clock time (ms) plus world x/z. */
interface WindowSample {
  t: number;
  x: number;
  z: number;
}

export interface TimingState {
  /** Index of the next checkpoint the player must pass. */
  next: number;
  lapStartT: number | null;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Rolling window of recent samples (server wall-clock ms + x/z), reset on lap start and Respawn. */
  windowSamples: WindowSample[];
  /** Becomes true if any window sample violates the speed bound; cleared on lap start and Respawn. */
  lapImplausible: boolean;
}

export function createTiming(): TimingState {
  return {
    next: 0,
    lapStartT: null,
    laps: 0,
    lastLapMs: null,
    bestLapMs: null,
    windowSamples: [],
    lapImplausible: false,
  };
}

/**
 * Mutate timing for a respawn: clear the in-progress lap and rewind checkpoint
 * progress to the start line, but keep the driver's completed laps, last lap,
 * and session best — those are facts that already happened.
 */
export function respawnTiming(t: TimingState): void {
  t.next = 0;
  t.lapStartT = null;
  t.windowSamples = [];
  t.lapImplausible = false;
}

export interface LapResult {
  lapTimeMs: number;
  isPersonalBest: boolean;
  /** False when the rolling-window speed bound or the lap-time floor was violated. */
  isPlausible: boolean;
}

const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;

/** Sliding window width for speed-bound checking (ms). */
const PLAUSIBILITY_WINDOW_MS = 1000;
/** Multiplier applied to maxSpeedMs to allow for network burst jitter. */
const SPEED_TOLERANCE = 1.1;

/**
 * True when the average speed across the window's samples exceeds the tolerated
 * speed bound — i.e. the car covered more ground than physically possible.
 */
function windowExceedsSpeedBound(
  samples: WindowSample[],
  now: number,
  maxSpeedMs: number
): boolean {
  if (samples.length < 2) return false;
  let totalDist = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  }
  const windowS = (now - samples[0].t) / 1000;
  return windowS > 0 && totalDist / windowS > maxSpeedMs * SPEED_TOLERANCE;
}

/**
 * Advance checkpoint progress from a reported position and validate plausibility.
 *
 * Maintains a rolling window of the last ~1 second of positions; if the total
 * path distance in that window exceeds `maxSpeedMs × 1.1`, the lap is flagged
 * implausible and `submitLap` must not persist it.  A lap that finishes below
 * `minLapMs` is also flagged.  Both flags are silent to the client.
 *
 * Checkpoints must be hit in order, so cutting the track never completes a lap.
 * Returns a result when a full lap completes at the start/finish line.
 */
export function updateTiming(
  t: TimingState,
  x: number,
  z: number,
  now: number,
  checkpoints: { x: number; z: number }[],
  maxSpeedMs: number,
  minLapMs: number
): LapResult | null {
  // Maintain rolling window only during an active lap.
  if (t.lapStartT !== null) {
    t.windowSamples.push({ t: now, x, z });
    // Check the speed bound on the untrimmed window *before* trimming. Trimming
    // first can collapse the buffer to a single sample whenever the gap since
    // the previous sample exceeds the window width, which makes
    // windowExceedsSpeedBound return false and lets a client pacing its updates
    // more than a window apart teleport any distance per hop undetected.
    if (!t.lapImplausible && windowExceedsSpeedBound(t.windowSamples, now, maxSpeedMs)) {
      t.lapImplausible = true;
    }
    while (t.windowSamples.length > 1 && now - t.windowSamples[0].t > PLAUSIBILITY_WINDOW_MS) {
      t.windowSamples.shift();
    }
  }

  const cp = checkpoints[t.next];
  const dx = x - cp.x;
  const dz = z - cp.z;
  if (dx * dx + dz * dz > R2) return null;

  let result: LapResult | null = null;
  if (t.next === 0) {
    if (t.lapStartT !== null) {
      const lapTimeMs = now - t.lapStartT;
      t.laps += 1;
      t.lastLapMs = lapTimeMs;
      const isPlausible = !t.lapImplausible && lapTimeMs >= minLapMs;
      // Only a plausible lap can become the personal best. An implausible lap
      // must not overwrite bestLapMs or report isPersonalBest — that PB state is
      // broadcast to the room even though the lap is barred from the leaderboard.
      const isPersonalBest = isPlausible && (t.bestLapMs === null || lapTimeMs < t.bestLapMs);
      if (isPersonalBest) t.bestLapMs = lapTimeMs;
      result = { lapTimeMs, isPersonalBest, isPlausible };
    }
    // Reset plausibility state for the new lap.
    t.lapStartT = now;
    t.lapImplausible = false;
    t.windowSamples = [{ t: now, x, z }];
  }
  t.next = (t.next + 1) % checkpoints.length;
  return result;
}
