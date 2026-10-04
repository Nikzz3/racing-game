import { BARRIER_OFFSET, CHECKPOINT_RADIUS, ROAD_HALF_WIDTH, type TrackSample } from "./track";

/** Added to the lap for every Checkpoint the car misses (ADR-0012). */
export const CHECKPOINT_PENALTY_MS = 2000;

const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;
/** Out to the barriers, past where physics lets a car go, so the start/finish cannot be driven around. */
const START_LINE_HALF_WIDTH = ROAD_HALF_WIDTH + BARRIER_OFFSET;
const START_LINE_R2 = START_LINE_HALF_WIDTH * START_LINE_HALF_WIDTH;

function inside(gate: TrackSample, index: number, x: number, z: number): boolean {
  const dx = x - gate.x;
  const dz = z - gate.z;
  const d2 = dx * dx + dz * dz;
  if (d2 <= R2) return true;
  // A car on the road enters the radius before it reaches the line, so this only
  // catches one passing the start beside the road, and on-road timing is unchanged.
  return index === 0 && d2 <= START_LINE_R2 && dx * gate.dirX + dz * gate.dirZ >= 0;
}

/**
 * The gate a car at (x, z) is in, searching forward from the owed gate `next`
 * up to the start/finish and at most half a lap ahead; null when it is in none.
 * Gates the search passed over were missed. The half-lap bound keeps a car
 * reversing over the start/finish from reaching the gates behind it.
 */
export function reachedCheckpoint(
  checkpoints: readonly TrackSample[],
  next: number,
  x: number,
  z: number,
): number | null {
  const n = checkpoints.length;
  for (let ahead = 0; ahead < n / 2; ahead++) {
    const index = (next + ahead) % n;
    if (inside(checkpoints[index], index, x, z)) return index;
    if (index === 0) return null;
  }
  return null;
}
