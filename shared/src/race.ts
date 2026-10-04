// A Race (see CONTEXT.md) is run by the server: it seats the Room's drivers and
// Pacers on a starting grid, counts down, ranks everyone by progress, and
// publishes results. These are the rules and shapes both sides share.

import type { ReplayFrame } from "./messages";
import { CHECKPOINT_RADIUS, type Track } from "./track";
import type { Variant } from "./variant";

/** Race: first to finish RACE_LAPS wins. Knockout: the last car to complete each lap is out. */
export const RACE_FORMATS = ["race", "knockout"] as const;
export type RaceFormat = (typeof RACE_FORMATS)[number];

/** Coerce arbitrary input to a valid format, falling back to a Race. */
export function asRaceFormat(value: unknown): RaceFormat {
  return (RACE_FORMATS as readonly unknown[]).includes(value) ? (value as RaceFormat) : "race";
}

/** Laps a Race runs. A Knockout instead runs one lap per elimination: entrants − 1. */
export const RACE_LAPS = 3;
/** Pacers fill empty slots until the grid holds this many cars. */
export const GRID_SIZE = 6;
/** From the start being called to GO. */
export const COUNTDOWN_MS = 3000;
/**
 * How long the rest of the field has once the first car finishes a Race, or
 * once the first car completes the current lap of a Knockout. Whoever has not
 * made it by then is out.
 */
export const GRACE_MS = 30_000;
/** How long the results screen shows before the Room returns to free driving. */
export const RESULTS_MS = 10_000;

/** countdown → racing → results; a Room with no race has a null RaceState. */
export type RacePhase = "countdown" | "racing" | "results";
/** `out` is a Knockout elimination, or a DNF (left the Room, or the grace period ran out). */
export type EntrantStatus = "racing" | "finished" | "out";

export interface RaceEntrant {
  /** The driver's player id, or a Pacer's race-scoped id (`pacer:<n>`). */
  id: string;
  name: string;
  /** Set for a Pacer filling an empty grid slot. */
  pacer?: true;
  /** Grid slot, 0 on pole. */
  slot: number;
  /** Laps completed since GO. */
  laps: number;
  status: EntrantStatus;
  /** Race time (ms from GO) at the finish. A Knockout's winner finishes when its last rival goes out. */
  finishMs?: number;
}

export interface RaceState {
  format: RaceFormat;
  phase: RacePhase;
  /** Laps to finish: RACE_LAPS for a Race, entrants − 1 for a Knockout. */
  laps: number;
  /** Server time of GO: the countdown ends and timing starts. */
  goT: number;
  /**
   * Server time the current deadline passes: the grace period's end while
   * racing (absent until the first car finishes, or completes the current
   * Knockout lap), or the results screen's end.
   */
  deadlineT?: number;
  /** In position order, leader first; the final classification once in results. */
  entrants: RaceEntrant[];
}

/** A Pacer's recorded lap, sent once per race; it drives the lap from the line at GO, looping it. */
export interface RacePacer {
  /** Matches its RaceEntrant id. */
  id: string;
  name: string;
  frames: ReplayFrame[];
  /** Variant recorded with the lap; absent → hash of `name`. */
  variant?: Variant;
}

/**
 * Rows of two, the front row just behind the start line: inside the start
 * gate, so its lap starts at GO, as the grid Pacers' do. Not the free-driving
 * spawn, whose run-up to the line would cost every driver ~45 m.
 */
const GRID_FRONT_FROM_END = 1;
const GRID_ROW_SAMPLES = 3;
const GRID_HALF_SPACING = 2.5;

/**
 * Where grid slot `slot` sits: a centerline sample index and a lateral offset,
 * as `CarPhysics.spawnAtSample` takes them. Slots fill two abreast, pole on the
 * left, rows stepping back from the start line; slots beyond GRID_SIZE
 * keep stepping back.
 */
export function gridSlot(track: Track, slot: number): { sample: number; offset: number } {
  const row = Math.floor(slot / 2);
  return {
    sample: track.samples.length - GRID_FRONT_FROM_END - row * GRID_ROW_SAMPLES,
    offset: slot % 2 === 0 ? -GRID_HALF_SPACING : GRID_HALF_SPACING,
  };
}

/**
 * Lap-relative time (ms) the recorded car first enters each checkpoint's
 * radius, or null for any it never reaches. Frames are scanned forward from the
 * previous hit, so the times are non-decreasing in checkpoint order.
 */
export function pacerCheckpointTimes(
  frames: ReplayFrame[],
  checkpoints: { x: number; z: number }[],
  radius = CHECKPOINT_RADIUS,
): (number | null)[] {
  const r2 = radius * radius;
  let scanFrom = 0;
  return checkpoints.map((cp) => {
    for (let i = scanFrom; i < frames.length; i++) {
      const [t, fx, fz] = frames[i];
      const dx = fx - cp.x,
        dz = fz - cp.z;
      if (dx * dx + dz * dz >= r2) continue;
      const enteredBeforeScan = i === scanFrom;
      scanFrom = i;
      if (enteredBeforeScan) return t;
      // frames[i-1] is outside the radius, so solve |p0 + f*d - cp|² = r² for
      // the fraction f of the segment at which the car crossed the boundary.
      const [t0, x0, z0] = frames[i - 1];
      const ddx = fx - x0,
        ddz = fz - z0,
        ex = x0 - cp.x,
        ez = z0 - cp.z;
      const A = ddx * ddx + ddz * ddz;
      if (A === 0) return t0;
      const B = 2 * (ex * ddx + ez * ddz);
      const C = ex * ex + ez * ez - r2;
      const disc = B * B - 4 * A * C;
      const frac = disc >= 0 ? Math.max(0, Math.min(1, (-B - Math.sqrt(disc)) / (2 * A))) : 0;
      return t0 + (t - t0) * frac;
    }
    return null;
  });
}
