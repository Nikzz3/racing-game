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

/** Control points [x, z] of the centerline, in order of travel. */
const CONTROL_POINTS: [number, number][] = [
  [0, -170],
  [90, -165],
  [160, -120],
  [175, -40],
  [150, 40],
  [180, 110],
  [120, 165],
  [30, 150],
  [-40, 175],
  [-120, 160],
  [-165, 95],
  [-120, 40],
  [-85, -10],
  [-150, -60],
  [-170, -130],
  [-90, -175],
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
