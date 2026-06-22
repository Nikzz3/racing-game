// Sunset Ridge Circuit: a closed Catmull-Rom spline in the XZ plane (y = 0, flat track).
// Both client (mesh generation, off-track checks) and server (checkpoint validation)
// derive everything from this single definition.

export const TRACK_NAME = "Sunset Ridge Circuit";

export const ROAD_HALF_WIDTH = 7;
/** Distance from road edge to the physical barrier wall. */
export const BARRIER_OFFSET = 6;
export const NUM_CHECKPOINTS = 12;
export const CHECKPOINT_RADIUS = 15;
export const TRACK_DIVISIONS = 512;

/** Three sectors per lap. S1 covers CPs 0–3, S2 covers 4–7, S3 covers 8–11. */
export const NUM_SECTORS = 3;
/** Checkpoint indices whose crossing ends a sector mid-lap. CP0 ends S3 via lap completion. */
export const MID_LAP_SECTOR_BOUNDARIES: readonly number[] = [4, 8];

/**
 * Control points [x, z] of the centerline, in order of travel.
 * Layout: start straight along the bottom, a fast right sweeper onto the right
 * side, a left-right chicane, a blast up to the top-right corner, esses across
 * the top, a downhill-style dive on the left into a double-apex sweep, and a
 * bottom-left corner back onto the start straight.
 */
const CONTROL_POINTS: [number, number][] = [
  [-40, -210],
  [40, -213],
  [110, -205],
  // T1: fast right sweeper
  [175, -180],
  [215, -120],
  // T2-T3: left-right chicane
  [196, -58],
  [157, -20],
  [178, 32],
  // run up the right side
  [225, 85],
  [235, 150],
  // T4: top-right corner
  [195, 200],
  [125, 185],
  // T5-T7: esses across the top
  [70, 215],
  [5, 185],
  [-60, 215],
  [-130, 205],
  // T8: top-left corner
  [-185, 155],
  // T9: dive to the inside
  [-150, 95],
  [-100, 60],
  [-105, -5],
  // T10-T11: double-apex right sweep back to the outside
  [-160, -35],
  [-205, -80],
  // T12: bottom-left corner onto the start straight
  [-195, -150],
  [-130, -195],
];

export interface TrackSample {
  x: number;
  z: number;
  /** Unit direction of travel at this point. */
  dirX: number;
  dirZ: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function sampleTrack(divisions: number = TRACK_DIVISIONS): TrackSample[] {
  const n = CONTROL_POINTS.length;
  const pts: { x: number; z: number }[] = [];
  for (let s = 0; s < divisions; s++) {
    const u = (s / divisions) * n;
    const i = Math.floor(u);
    const t = u - i;
    const p0 = CONTROL_POINTS[(i - 1 + n) % n];
    const p1 = CONTROL_POINTS[i % n];
    const p2 = CONTROL_POINTS[(i + 1) % n];
    const p3 = CONTROL_POINTS[(i + 2) % n];
    pts.push({
      x: catmullRom(p0[0], p1[0], p2[0], p3[0], t),
      z: catmullRom(p0[1], p1[1], p2[1], p3[1], t),
    });
  }
  return pts.map((p, idx) => {
    const next = pts[(idx + 1) % divisions];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x, z: p.z, dirX: dx / len, dirZ: dz / len };
  });
}

export const TRACK_SAMPLES: TrackSample[] = sampleTrack();

/** Checkpoint 0 is the start/finish line. Laps count only if all are hit in order. */
export const CHECKPOINTS: { x: number; z: number }[] = Array.from(
  { length: NUM_CHECKPOINTS },
  (_, k) => {
    const s = TRACK_SAMPLES[Math.floor((k * TRACK_DIVISIONS) / NUM_CHECKPOINTS)];
    return { x: s.x, z: s.z };
  }
);

/** Nearest centerline sample to a world position (full scan; 512 points is cheap). */
export function nearestCenterline(x: number, z: number): { index: number; dist: number } {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < TRACK_SAMPLES.length; i++) {
    const s = TRACK_SAMPLES[i];
    const dx = x - s.x;
    const dz = z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return { index: best, dist: Math.sqrt(bestD2) };
}
