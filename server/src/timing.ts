import { CHECKPOINTS, CHECKPOINT_RADIUS, NUM_CHECKPOINTS } from "@racing/shared";

export interface TimingState {
  /** Index of the next checkpoint the player must pass. */
  next: number;
  lapStartT: number | null;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
}

export function createTiming(): TimingState {
  return { next: 0, lapStartT: null, laps: 0, lastLapMs: null, bestLapMs: null };
}

/**
 * Mutate timing for a respawn: clear the in-progress lap and rewind checkpoint
 * progress to the start line, but keep the driver's completed laps, last lap,
 * and session best — those are facts that already happened.
 */
export function respawnTiming(t: TimingState): void {
  t.next = 0;
  t.lapStartT = null;
}

export interface LapResult {
  lapTimeMs: number;
  isPersonalBest: boolean;
}

const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;

/**
 * Advance checkpoint progress from a reported position. Checkpoints must be hit in
 * order, so cutting the track never completes a lap. Returns a result when a full
 * lap is completed at the start/finish line.
 */
export function updateTiming(
  t: TimingState,
  x: number,
  z: number,
  now: number
): LapResult | null {
  const cp = CHECKPOINTS[t.next];
  const dx = x - cp.x;
  const dz = z - cp.z;
  if (dx * dx + dz * dz > R2) return null;

  let result: LapResult | null = null;
  if (t.next === 0) {
    if (t.lapStartT !== null) {
      const lapTimeMs = now - t.lapStartT;
      t.laps += 1;
      t.lastLapMs = lapTimeMs;
      const isPersonalBest = t.bestLapMs === null || lapTimeMs < t.bestLapMs;
      if (isPersonalBest) t.bestLapMs = lapTimeMs;
      result = { lapTimeMs, isPersonalBest };
    }
    t.lapStartT = now;
  }
  t.next = (t.next + 1) % NUM_CHECKPOINTS;
  return result;
}
