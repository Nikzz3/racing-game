// A racing line for Jev (ADR-0011): the centre line smoothed toward the inside
// of each bend, but never more than RACING_LINE_HALF_WIDTH from the centre, so
// a car that follows it closely stays well on the tarmac.

import type { Track, TrackSample } from "./track";

/** How far (m) the racing line may stray from the centre line, either side. */
export const RACING_LINE_HALF_WIDTH = 3;
/** Each point relaxes toward the midpoint of its neighbours this many samples away. */
const NEIGHBOUR = 3;
const ITERATIONS = 3000;

const cache = new WeakMap<Track, TrackSample[]>();

/**
 * One point per centre-line sample (same index, same closed loop), each moved
 * sideways along the road's left normal: repeatedly relaxing every point toward
 * the midpoint of its neighbours straightens the path — it cuts across the
 * inside of bends — and clamping keeps it within RACING_LINE_HALF_WIDTH.
 * Deterministic, and computed once per Track.
 */
export function racingLine(track: Track): TrackSample[] {
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
  const points = samples.map((_, i) => ({ x: x(i), z: z(i) }));
  const line = points.map((p, i) => {
    const next = points[(i + 1) % n];
    const length = Math.hypot(next.x - p.x, next.z - p.z) || 1;
    return {
      x: p.x,
      z: p.z,
      dirX: (next.x - p.x) / length,
      dirZ: (next.z - p.z) / length,
    };
  });
  cache.set(track, line);
  return line;
}
