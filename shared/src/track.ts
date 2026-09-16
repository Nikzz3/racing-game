// Tracks are closed Catmull-Rom splines in the XZ plane (y = 0). Client mesh
// generation, off-track checks and server checkpoint validation all derive from
// the sampled centerline defined here.

export const ROAD_HALF_WIDTH = 7;
/** Distance from road edge to the physical barrier wall. */
export const BARRIER_OFFSET = 6;
export const NUM_CHECKPOINTS = 12;
export const CHECKPOINT_RADIUS = 8;
export const TRACK_DIVISIONS = 512;

export type TrackSlug = string;
export const DEFAULT_TRACK_SLUG: TrackSlug = "sunset-ridge";

export interface TrackSample {
  x: number;
  z: number;
  /** Unit direction of travel at this point. */
  dirX: number;
  dirZ: number;
}

export interface Track {
  id: TrackSlug;
  name: string;
  controlPoints: readonly [number, number][];
  samples: TrackSample[];
  checkpoints: { x: number; z: number }[];
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

function sampleTrack(controlPoints: readonly [number, number][]): TrackSample[] {
  const n = controlPoints.length;
  const pts: { x: number; z: number }[] = [];
  for (let s = 0; s < TRACK_DIVISIONS; s++) {
    const u = (s / TRACK_DIVISIONS) * n;
    const i = Math.floor(u);
    const t = u - i;
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i % n];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];
    pts.push({
      x: catmullRom(p0[0], p1[0], p2[0], p3[0], t),
      z: catmullRom(p0[1], p1[1], p2[1], p3[1], t),
    });
  }
  return pts.map((p, idx) => {
    const next = pts[(idx + 1) % TRACK_DIVISIONS];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x, z: p.z, dirX: dx / len, dirZ: dz / len };
  });
}

/** Nearest centerline sample to a world position (full scan; 512 points is ~1 µs). */
export function nearestCenterline(
  x: number,
  z: number,
  samples: TrackSample[]
): { index: number; dist: number } {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
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

/**
 * Sunset Ridge Circuit centerline [x, z], in order of travel: start straight
 * along the bottom, a fast right sweeper onto the right side, a left-right
 * chicane, a blast up to the top-right corner, esses across the top, a dive on
 * the left into a double-apex sweep, and a bottom-left corner back onto the
 * start straight.
 */
const SUNSET_RIDGE_CONTROL_POINTS: [number, number][] = [
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

const sunsetRidgeSamples = sampleTrack(SUNSET_RIDGE_CONTROL_POINTS);

// Sunset Ridge spaces NUM_CHECKPOINTS gates evenly along the centerline.
export const SUNSET_RIDGE: Track = {
  id: "sunset-ridge",
  name: "Sunset Ridge Circuit",
  controlPoints: SUNSET_RIDGE_CONTROL_POINTS,
  samples: sunsetRidgeSamples,
  checkpoints: Array.from({ length: NUM_CHECKPOINTS }, (_, k) => {
    const s = sunsetRidgeSamples[Math.floor((k * TRACK_DIVISIONS) / NUM_CHECKPOINTS)];
    return { x: s.x, z: s.z };
  }),
};

/**
 * Stormhaven Circuit centerline [x, z]. "Serpent's Coil": a fast, open outer
 * loop wrapped around a tight, knotted infield, with the technical corners
 * clustered on one side. Original layout, not a trace of any real circuit.
 *
 *   S1: Start/finish on the long right-hand main straight → sweeps down to the bottom
 *   S2: Long curving back straight (bottom) → heavy-braking hairpin at the far corner
 *   S3: High-speed esse snake → triple-apex tightening spiral
 *   S4: Long curving top straight → fast top-right sweep back onto the main straight
 */
const STORMHAVEN_CONTROL_POINTS: [number, number][] = [
  [232, 30],     // T0 – start/finish, mid main straight (right edge)
  [228, -60],    // main straight sweeping down
  [218, -150],   // T1 turn-in
  [188, -202],   // T1 exit onto the bottom
  [110, -220],   // long curving back straight (bottom)
  [25, -220],    // back straight continuing
  [-65, -208],   // back straight approach to the hairpin
  [-150, -188],  // hairpin braking zone
  [-198, -150],  // T2 – heavy-braking hairpin apex (far bottom-left, eased open)
  [-190, -102],  // hairpin exit
  [-150, -72],   // into the infield
  [-110, -100],  // T3 – esse snake (swing 1, amplitude eased)
  [-70, -73],    // esse swing 2
  [-30, -100],   // esse swing 3
  [10, -70],     // esse swing 4
  [45, -94],     // esse swing 5
  [95, -70],     // esse snake exit
  [135, -20],    // T4 – triple-apex spiral entry
  [140, 40],     // spiral apex 1
  [110, 80],     // spiral apex 2 (tightening)
  [60, 95],      // spiral apex 3
  [0, 80],       // spiral exit
  [-70, 112],    // sweep out toward the top-left (rounds the entry)
  [-140, 150],   // top-left apex of the outer loop
  [-95, 172],    // rounds the exit onto the top straight
  [-40, 178],    // long curving top straight
  [90, 175],     // top straight → top-right sweep
  [185, 140],    // fast top-right sweeper
  [225, 90],     // sweep exit → loop closes back to T0
];

const stormhavenSamples = sampleTrack(STORMHAVEN_CONTROL_POINTS);

// Stormhaven folds back on itself, so it places one gate per control point (at
// the nearest centerline sample) to make the apex-to-apex path the racing line.
// Control points are already in lap order, so gate 0 is the start/finish.
export const STORMHAVEN: Track = {
  id: "stormhaven",
  name: "Stormhaven Circuit",
  controlPoints: STORMHAVEN_CONTROL_POINTS,
  samples: stormhavenSamples,
  checkpoints: STORMHAVEN_CONTROL_POINTS.map(([cx, cz]) => {
    const s = stormhavenSamples[nearestCenterline(cx, cz, stormhavenSamples).index];
    return { x: s.x, z: s.z };
  }),
};

export const TRACKS: Track[] = [SUNSET_RIDGE, STORMHAVEN];

export function getTrack(slug: string): Track | undefined {
  return TRACKS.find((t) => t.id === slug);
}

/** Resolve arbitrary input to a registered Track, falling back to the default. */
export function resolveTrack(value: unknown): Track {
  return TRACKS.find((t) => t.id === value) ?? SUNSET_RIDGE;
}

/** Coerce arbitrary input to a valid track slug, falling back to the default. */
export function asTrackSlug(value: unknown): TrackSlug {
  return resolveTrack(value).id;
}

/**
 * Fraction of the theoretical fastest lap below which a lap is treated as
 * implausibly fast (ADR-0005). Below 1.0 because the centerline underestimates
 * the real racing line, so an honest lap can slightly beat the naive floor.
 */
const MIN_LAP_FRACTION = 0.85;

/**
 * Lower bound (ms) on a plausible lap time for `track` at `maxSpeedMs`:
 * `MIN_LAP_FRACTION × centerline length / max speed` (ADR-0005).
 */
export function minPlausibleLapMs(track: Track, maxSpeedMs: number): number {
  const s = track.samples;
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const next = s[(i + 1) % s.length];
    len += Math.hypot(next.x - s[i].x, next.z - s[i].z);
  }
  return Math.floor((MIN_LAP_FRACTION * len) / maxSpeedMs * 1000);
}

/**
 * A Track's centerline as a closed SVG path (world x → SVG x, world z → SVG y),
 * followed by a short perpendicular start/finish tick at sample 0.
 */
export function trackPath(track: Track): string {
  const { samples } = track;
  const outline = samples
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.z.toFixed(1)}`)
    .join(" ");
  const s0 = samples[0];
  const tickLen = 12;
  const mx1 = (s0.x - s0.dirZ * tickLen).toFixed(1);
  const mz1 = (s0.z + s0.dirX * tickLen).toFixed(1);
  const mx2 = (s0.x + s0.dirZ * tickLen).toFixed(1);
  const mz2 = (s0.z - s0.dirX * tickLen).toFixed(1);
  return `${outline} Z M${mx1},${mz1}L${mx2},${mz2}`;
}
