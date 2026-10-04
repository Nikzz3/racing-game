// Tracks are closed Catmull-Rom splines in the XZ plane (y = 0). Client mesh
// generation, off-track checks and server checkpoint validation all derive from
// the sampled centerline defined here, from the control points in tracks/*.json.

import arrowhead from "./tracks/arrowhead.json" with { type: "json" };
import stormhaven from "./tracks/stormhaven.json" with { type: "json" };
import sunsetRidge from "./tracks/sunset-ridge.json" with { type: "json" };

export const ROAD_HALF_WIDTH = 7;
/** Distance from road edge to the physical barrier wall. */
export const BARRIER_OFFSET = 6;
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
  samples: TrackSample[],
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
 * How a Track places its checkpoints (ADR-0003): a number spaces that many gates
 * evenly along the centerline; `control-points` gates every control point, for
 * layouts that fold back on themselves so the apex-to-apex path is the racing line.
 */
export type CheckpointLayout = number | "control-points";

/**
 * A Track as stored in `tracks/<slug>.json`. Tracks drawn in Blender export this
 * file from their centerline curve (`assets/blender/track_tools.py`); the Python
 * RL port reads the same files.
 */
export interface TrackSource {
  id: TrackSlug;
  name: string;
  description: string;
  checkpoints: CheckpointLayout;
  controlPoints: [number, number][];
}

function parseTrackSource(value: unknown): TrackSource {
  const source = value as Partial<TrackSource>;
  const valid =
    typeof source.id === "string" &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(source.id) &&
    typeof source.name === "string" &&
    typeof source.description === "string" &&
    (source.checkpoints === "control-points" ||
      (Number.isInteger(source.checkpoints) && (source.checkpoints as number) >= 4)) &&
    Array.isArray(source.controlPoints) &&
    source.controlPoints.length >= 4 &&
    source.controlPoints.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every((c) => Number.isFinite(c)),
    );
  if (!valid) throw new Error(`Invalid track source: ${JSON.stringify(value).slice(0, 80)}`);
  return source as TrackSource;
}

/** Builds a Track from its JSON source: centerline samples plus checkpoint gates. */
export function defineTrack(value: unknown): Track {
  const { id, name, checkpoints, controlPoints } = parseTrackSource(value);
  const samples = sampleTrack(controlPoints);
  return {
    id,
    name,
    controlPoints,
    samples,
    checkpoints:
      checkpoints === "control-points"
        ? // Control points are in lap order, so gate 0 is the start/finish.
          controlPoints.map(([cx, cz]) => {
            const s = samples[nearestCenterline(cx, cz, samples).index];
            return { x: s.x, z: s.z };
          })
        : Array.from({ length: checkpoints }, (_, k) => {
            const s = samples[Math.floor((k * TRACK_DIVISIONS) / checkpoints)];
            return { x: s.x, z: s.z };
          }),
  };
}

export const SUNSET_RIDGE = defineTrack(sunsetRidge);
export const STORMHAVEN = defineTrack(stormhaven);
export const ARROWHEAD = defineTrack(arrowhead);

/** Every playable Track, in lobby order. Register a new `tracks/<slug>.json` here. */
export const TRACKS: Track[] = [SUNSET_RIDGE, STORMHAVEN, ARROWHEAD];

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
  return Math.floor(((MIN_LAP_FRACTION * len) / maxSpeedMs) * 1000);
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
