import {
  BARRIER_OFFSET,
  CHECKPOINT_RADIUS,
  GRIP_FADE,
  MAX_SPEED_MS,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  speedForTurnRadius,
  STEER_RATE,
  type Track,
} from "@racing/shared";

/**
 * Measures a Track's layout from its centerline. `track-design.test.ts` holds every
 * Track to the drivability rules below; `npm run track:check` prints the same numbers
 * in its drive report.
 */

/** Below this radius the inner road edge bunches up and the corner is no longer "easy". */
export const MIN_CORNER_RADIUS = 30;
/** Separate parts of the circuit keep their barriers apart: road + barrier on both sides. */
export const MIN_CLEARANCE = 2 * (ROAD_HALF_WIDTH + BARRIER_OFFSET);
/** A section this open reads and drives as a straight. */
export const STRAIGHT_RADIUS = 300;
/** Bends closer than this (m) along the road are read as one corner. */
const MERGE_GAP = 30;
/** Shorter open runs are the hinge between two bends, not a straight. */
const MIN_STRAIGHT = 50;
/** Chord/arc between consecutive gates; lower means grass cutting pays (ADR-0003). */
export const MIN_GATE_CHORD_RATIO = 0.8;
/** Arc length treated as "the same stretch of road" when measuring clearance. */
const NEIGHBOURHOOD = 80;

export type CornerKind = "flat" | "fast" | "medium" | "slow";

export interface Corner {
  /** Sample index of the tightest point. */
  apex: number;
  startM: number;
  lengthM: number;
  radius: number;
  /** Fastest speed (m/s) at which full lock holds the apex radius. */
  apexSpeed: number;
  kind: CornerKind;
}

export interface TrackDesign {
  lengthM: number;
  /** Metres along the lap at each sample. */
  distance: number[];
  /** Local turning radius at each sample (Infinity on a perfect straight). */
  radius: number[];
  minRadius: number;
  /** Closest approach of two parts of the circuit that are not the same stretch. */
  clearance: { metres: number; a: number; b: number };
  straights: { startM: number; lengthM: number }[];
  straightShare: number;
  /** Straight road through the start line: run-up from the spawn plus the run beyond. */
  startStraightM: number;
  corners: Corner[];
  worstGateChordRatio: number;
  /** Gates that sit off the centerline or out of lap order. */
  misplacedGates: number[];
}

/** Radius of the circle through three points, signed by which way the road turns. */
function signedRadius(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  const ab = Math.hypot(bx - ax, bz - az);
  const bc = Math.hypot(cx - bx, cz - bz);
  const ca = Math.hypot(ax - cx, az - cz);
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  return Math.abs(cross) < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

/** Medium is the reference Difficulty: corners are graded against its top speed. */
function cornerKind(apexSpeed: number): CornerKind {
  const share = apexSpeed / MAX_SPEED_MS.medium;
  if (share >= 1) return "flat";
  if (share >= 0.75) return "fast";
  if (share >= 0.5) return "medium";
  return "slow";
}

export function measureTrack(track: Track): TrackDesign {
  const s = track.samples;
  const n = s.length;
  const at = (i: number) => s[((i % n) + n) % n];
  const distance = [0];
  for (let i = 1; i <= n; i++)
    distance.push(distance[i - 1] + Math.hypot(at(i).x - at(i - 1).x, at(i).z - at(i - 1).z));
  const lengthM = distance[n];
  distance.length = n;
  const spacing = lengthM / n;

  // Measure across ~30 m so sampling noise and 0.1 m rounding do not read as curvature.
  const k = Math.max(1, Math.round(15 / spacing));
  const turn = s.map((_, i) => {
    const a = at(i - k),
      b = at(i),
      c = at(i + k);
    return signedRadius(a.x, a.z, b.x, b.z, c.x, c.z);
  });
  const radius = turn.map(Math.abs);
  const minRadius = Math.min(...radius);

  const arcBetween = (i: number, j: number) => {
    const d = Math.abs(distance[i] - distance[j]);
    return Math.min(d, lengthM - d);
  };
  let clearance = { metres: Infinity, a: 0, b: 0 };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (arcBetween(i, j) < NEIGHBOURHOOD) continue;
      const d = Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z);
      if (d < clearance.metres) clearance = { metres: d, a: i, b: j };
    }

  // Runs of samples matching `test`, as [first, count], walking the closed loop once.
  const runs = (test: (i: number) => boolean): [number, number][] => {
    const begin = s.findIndex((_, i) => !test(i));
    if (begin < 0) return [[0, n]];
    const found: [number, number][] = [];
    for (let step = 1; step <= n; step++) {
      const i = (begin + step) % n;
      if (!test(i)) continue;
      if (test((i - 1 + n) % n) && found.length) found[found.length - 1][1]++;
      else found.push([i, 1]);
    }
    return found;
  };
  const straights = runs((i) => radius[i] >= STRAIGHT_RADIUS)
    .map(([first, count]) => ({ startM: distance[first], lengthM: count * spacing }))
    .filter((straight) => straight.lengthM >= MIN_STRAIGHT);
  const flatRadius = radiusForSpeed(MAX_SPEED_MS.medium);
  // One bend whose radius hovers around the threshold is one corner, not several;
  // a change of direction always starts a new corner, so a chicane counts twice.
  const bends: [number, number][] = [];
  for (const [first, count] of runs((i) => radius[i] < flatRadius)) {
    const last = bends[bends.length - 1];
    const gap = last ? (first - (last[0] + last[1]) + n) % n : Infinity;
    const sameWay = last && Math.sign(turn[last[0]]) === Math.sign(turn[first]);
    if (sameWay && gap * spacing < MERGE_GAP) last[1] += gap + count;
    else bends.push([first, count]);
  }
  const corners = bends.map(([first, count]): Corner => {
    let apex = first;
    for (let step = 0; step < count; step++)
      if (radius[(first + step) % n] < radius[apex]) apex = (first + step) % n;
    const apexSpeed = speedForTurnRadius(radius[apex]);
    return {
      apex,
      startM: distance[first],
      lengthM: count * spacing,
      radius: radius[apex],
      apexSpeed,
      kind: cornerKind(apexSpeed),
    };
  });

  let startStraightM = 0;
  for (let i = 0; i < n && radius[i] >= STRAIGHT_RADIUS; i++) startStraightM += spacing;
  for (let i = n - 1; i > 0 && radius[i] >= STRAIGHT_RADIUS; i--) startStraightM += spacing;

  const gates = track.checkpoints.map((cp) => nearestCenterline(cp.x, cp.z, s));
  const misplacedGates = gates.flatMap((gate, g) =>
    gate.dist > CHECKPOINT_RADIUS || (g > 0 && gate.index <= gates[g - 1].index) ? [g] : [],
  );
  let worstGateChordRatio = 1;
  gates.forEach((gate, g) => {
    const next = gates[(g + 1) % gates.length];
    const arc = (distance[next.index] - distance[gate.index] + lengthM) % lengthM;
    const cp = track.checkpoints[g],
      np = track.checkpoints[(g + 1) % gates.length];
    if (arc > 0)
      worstGateChordRatio = Math.min(
        worstGateChordRatio,
        Math.hypot(np.x - cp.x, np.z - cp.z) / arc,
      );
  });

  return {
    lengthM,
    distance,
    radius,
    minRadius,
    clearance,
    straights,
    straightShare: straights.reduce((sum, st) => sum + st.lengthM, 0) / lengthM,
    startStraightM,
    corners,
    worstGateChordRatio,
    misplacedGates,
  };
}

/** Inverse of speedForTurnRadius: the tightest radius full lock holds at `speed` m/s. */
export function radiusForSpeed(speed: number): number {
  return (speed * (1 + GRIP_FADE * speed)) / STEER_RATE;
}
