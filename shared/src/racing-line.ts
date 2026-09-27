// A racing line for Jev (ADR-0011): the centre line smoothed toward the inside
// of each bend, but never more than RACING_LINE_HALF_WIDTH from the centre, so
// a car that follows it closely stays well on the tarmac.

import type { Track, TrackSample } from "./track";

/** How far (m) the racing line may stray from the centre line, either side. */
export const RACING_LINE_HALF_WIDTH = 3;
/** Each point relaxes toward the midpoint of its neighbours this many samples away. */
const NEIGHBOUR = 3;
const ITERATIONS = 3000;

interface RacingLine {
  points: TrackSample[];
  /** Arc length (m) along the line from point 0 to each point. */
  distance: Float64Array;
  /** Arc length (m) of the whole closed loop. */
  length: number;
}

const cache = new WeakMap<Track, RacingLine>();

/**
 * One point per centre-line sample (same index, same closed loop), each moved
 * sideways along the road's left normal: repeatedly relaxing every point toward
 * the midpoint of its neighbours straightens the path — it cuts across the
 * inside of bends — and clamping keeps it within RACING_LINE_HALF_WIDTH.
 * Deterministic, and computed once per Track: about 20 ms, so warm it up before
 * anything time-critical first needs it.
 */
export function racingLine(track: Track): TrackSample[] {
  return build(track).points;
}

/**
 * The point `metres` further along the racing line from its point `index`,
 * measured along the line itself — centre-line samples, and so the line's
 * points, are unevenly spaced — with the direction of the segment it lies on.
 */
export function racingLineAhead(track: Track, index: number, metres: number): TrackSample {
  const { points, distance, length } = build(track);
  const n = points.length;
  const target = (((distance[index % n] + metres) % length) + length) % length;
  // The last point at or before the target distance.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (distance[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const from = points[lo];
  const along = target - distance[lo];
  return {
    x: from.x + from.dirX * along,
    z: from.z + from.dirZ * along,
    dirX: from.dirX,
    dirZ: from.dirZ,
  };
}

function build(track: Track): RacingLine {
  const cached = cache.get(track);
  if (cached) return cached;
  const { samples } = track;
  const n = samples.length;
  // (dirZ, -dirX) is the road's left, the side positive lateral offsets are on.
  const offset = new Float64Array(n);
  const x = (i: number) => samples[i].x + samples[i].dirZ * offset[i];
  const z = (i: number) => samples[i].z - samples[i].dirX * offset[i];
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (let i = 0; i < n; i++) {
      const a = (i - NEIGHBOUR + n) % n;
      const b = (i + NEIGHBOUR) % n;
      const midX = (x(a) + x(b)) / 2 - samples[i].x;
      const midZ = (z(a) + z(b)) / 2 - samples[i].z;
      const target = midX * samples[i].dirZ - midZ * samples[i].dirX;
      const relaxed = offset[i] + 0.5 * (target - offset[i]);
      offset[i] = Math.max(-RACING_LINE_HALF_WIDTH, Math.min(RACING_LINE_HALF_WIDTH, relaxed));
    }
  }
  const coords = samples.map((_, i) => ({ x: x(i), z: z(i) }));
  const distance = new Float64Array(n);
  const points = coords.map((p, i) => {
    const next = coords[(i + 1) % n];
    const segment = Math.hypot(next.x - p.x, next.z - p.z);
    if (i + 1 < n) distance[i + 1] = distance[i] + segment;
    const unit = segment || 1;
    return { x: p.x, z: p.z, dirX: (next.x - p.x) / unit, dirZ: (next.z - p.z) / unit };
  });
  const closing = coords[n - 1];
  const length = distance[n - 1] + Math.hypot(coords[0].x - closing.x, coords[0].z - closing.z);
  const line = { points, distance, length };
  cache.set(track, line);
  return line;
}
