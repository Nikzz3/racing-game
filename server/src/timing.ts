import {
  CHECKPOINTS,
  CHECKPOINT_RADIUS,
  MID_LAP_SECTOR_BOUNDARIES,
  NUM_CHECKPOINTS,
} from "@racing/shared";

export interface TimingState {
  /** Index of the next checkpoint the player must pass. */
  next: number;
  lapStartT: number | null;
  /** Time spent in sector 1 of the lap in progress. Set when CP4 is crossed; cleared at lap end. */
  s1SplitMs: number | null;
  /** Time spent in sector 2 of the lap in progress. Set when CP8 is crossed; cleared at lap end. */
  s2SplitMs: number | null;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
}

export function createTiming(): TimingState {
  return {
    next: 0,
    lapStartT: null,
    s1SplitMs: null,
    s2SplitMs: null,
    laps: 0,
    lastLapMs: null,
    bestLapMs: null,
  };
}

/**
 * Mutate timing for a respawn: clear the in-progress lap, its sector splits,
 * and rewind checkpoint progress to the start line. Keeps the driver's completed
 * laps, last lap, and session best — those are facts that already happened.
 */
export function respawnTiming(t: TimingState): void {
  t.next = 0;
  t.lapStartT = null;
  t.s1SplitMs = null;
  t.s2SplitMs = null;
}

export interface LapResult {
  lapTimeMs: number;
  isPersonalBest: boolean;
  s1SplitMs: number;
  s2SplitMs: number;
  s3SplitMs: number;
}

export interface SectorBoundary {
  sector: 1 | 2;
  splitMs: number;
}

export interface TimingUpdate {
  /** True on every CP0 crossing (lap completion and/or new lap start). */
  lapStarted: boolean;
  /** Set when CP4 or CP8 is crossed mid-lap. */
  sector: SectorBoundary | null;
  /** Set when a full lap completes. */
  lap: LapResult | null;
}

const NO_UPDATE: TimingUpdate = { lapStarted: false, sector: null, lap: null };
const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;

/**
 * Advance checkpoint progress from a reported position. Checkpoints must be hit in
 * order, so cutting the track never completes a lap or a sector. Returns the events
 * triggered by this update: sector boundary, lap completion, lap start (or none).
 */
export function updateTiming(
  t: TimingState,
  x: number,
  z: number,
  now: number
): TimingUpdate {
  const cp = CHECKPOINTS[t.next];
  const dx = x - cp.x;
  const dz = z - cp.z;
  if (dx * dx + dz * dz > R2) return NO_UPDATE;

  let lap: LapResult | null = null;
  let sector: SectorBoundary | null = null;
  let lapStarted = false;

  if (t.next === 0) {
    if (t.lapStartT !== null) {
      const lapTimeMs = now - t.lapStartT;
      t.laps += 1;
      t.lastLapMs = lapTimeMs;
      const isPersonalBest = t.bestLapMs === null || lapTimeMs < t.bestLapMs;
      if (isPersonalBest) t.bestLapMs = lapTimeMs;
      // s1 and s2 are guaranteed non-null here: lap completion requires CP4 and
      // CP8 to have been hit in order earlier in this lap.
      const s1 = t.s1SplitMs ?? 0;
      const s2 = t.s2SplitMs ?? 0;
      lap = {
        lapTimeMs,
        isPersonalBest,
        s1SplitMs: s1,
        s2SplitMs: s2,
        s3SplitMs: lapTimeMs - s1 - s2,
      };
    }
    t.lapStartT = now;
    t.s1SplitMs = null;
    t.s2SplitMs = null;
    lapStarted = true;
  } else if (MID_LAP_SECTOR_BOUNDARIES.includes(t.next) && t.lapStartT !== null) {
    const tFromLapStart = now - t.lapStartT;
    if (t.next === 4) {
      const splitMs = tFromLapStart;
      t.s1SplitMs = splitMs;
      sector = { sector: 1, splitMs };
    } else {
      // t.next === 8
      const splitMs = tFromLapStart - (t.s1SplitMs ?? 0);
      t.s2SplitMs = splitMs;
      sector = { sector: 2, splitMs };
    }
  }

  t.next = (t.next + 1) % NUM_CHECKPOINTS;
  return { lapStarted, sector, lap };
}
