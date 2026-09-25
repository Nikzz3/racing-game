// Jev drives (ADR-0009): TypeSafe's System One model reads a text description of
// the car and the road ahead and answers two Choice questions — brake or
// accelerate, steer left or right. Code owns the geometry, the physics and the
// mapping from probabilities to pedals; Jev only supplies the judgment. The
// server asks the questions (it holds the API key); the client uses the same
// state builder to show players exactly what Jev saw.

import { type Difficulty } from "./difficulty";
import { nearestCenterline, ROAD_HALF_WIDTH, type Track, type TrackSlug } from "./track";
import type { Variant } from "./variant";

/** Jev drives where its cornering guide was tuned: Medium grip, Sunset Ridge. */
export const JEV_TRACK: TrackSlug = "sunset-ridge";
export const JEV_DIFFICULTY: Difficulty = "medium";
/** The canonical car Jev drives, distinct from the AI Record's police car. */
export const JEV_VARIANT: Variant = "race-future";
/** Game time between decisions in a recorded Jev Lap (6 steps at 1/60 s). */
export const JEV_DECISION_INTERVAL_MS = 100;

/** The car state Jev judges: world position, heading (rad) and speed (m/s). */
export interface JevPose {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Jev's answers: P(accelerate) against brake, P(left) against right, and how sure each pick is. */
export interface JevDecision {
  accelerate: number;
  left: number;
  /** TypeSafe's confidence (0–1) in the pedal pick, derived from its distribution. */
  pedalConfidence: number;
  /** TypeSafe's confidence (0–1) in the steering pick. */
  steerConfidence: number;
}

/** The state object sent to Jev; every field is plain English or a number. */
export interface JevDrivingState {
  speed_kmh: number;
  on_tarmac: boolean;
  car_position: string;
  nose_direction: string;
  road_ahead: string[];
  bend_ahead: string;
}

/** Distances (m) along the centerline at which the road centre is described. */
const AIM_DISTANCES = [15, 30, 50, 80];
/** A bend is measured as the heading change over this many metres of road. */
const BEND_LENGTH = 40;
/** Bend search horizon: starts up to this far ahead are considered. */
const BEND_SEARCH = 150;
const BEND_SEARCH_STEP = 10;
/** Below this many degrees over BEND_LENGTH the road reads as straight. */
const STRAIGHT_DEGREES = 8;
/** Matches CarPhysics: the car is on the tarmac within this of the centre line. */
const ON_TARMAC_DIST = ROAD_HALF_WIDTH + 0.6;

const sampleSpacing = new WeakMap<Track, number>();

/** Mean distance between consecutive centerline samples, in metres. */
function spacing(track: Track): number {
  let cached = sampleSpacing.get(track);
  if (cached === undefined) {
    const { samples } = track;
    let length = 0;
    for (let i = 0; i < samples.length; i++) {
      const next = samples[(i + 1) % samples.length];
      length += Math.hypot(next.x - samples[i].x, next.z - samples[i].z);
    }
    cached = length / samples.length;
    sampleSpacing.set(track, cached);
  }
  return cached;
}

function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

const degrees = (radians: number): number => Math.round((Math.abs(radians) * 180) / Math.PI);
/** Heading grows when steering left (steer +1 is A / ArrowLeft), so positive angles are left. */
const side = (radians: number): string => (radians >= 0 ? "left" : "right");

/**
 * Describe the car and the road ahead the way a co-driver would: where the car
 * sits on the road, where it points, where the road centre lies ahead, and the
 * sharpest bend coming up. Angles are relative to the car's nose or the road
 * direction, so Jev never has to reason about world coordinates.
 */
export function jevDrivingState(pose: JevPose, track: Track): JevDrivingState {
  const { samples } = track;
  const step = spacing(track);
  const nearest = nearestCenterline(pose.x, pose.z, samples);
  const here = samples[nearest.index];
  const at = (metres: number) =>
    samples[(nearest.index + Math.round(metres / step)) % samples.length];
  const roadHeading = (metres: number): number => {
    const s = at(metres);
    return Math.atan2(s.dirX, s.dirZ);
  };

  // > 0 when the car is left of the direction of travel. Steering left turns the
  // heading up, which carries the car along (dirZ, -dirX): that is its left.
  const lateral = here.dirZ * (pose.x - here.x) - here.dirX * (pose.z - here.z);
  const noseError = normalizeAngle(pose.heading - roadHeading(0));

  const roadAhead = AIM_DISTANCES.map((metres) => {
    const target = at(metres);
    const bearing = normalizeAngle(Math.atan2(target.x - pose.x, target.z - pose.z) - pose.heading);
    return `${metres} m ahead the road centre is ${degrees(bearing)}° to the ${side(bearing)} of where the car is pointing`;
  });

  let sharpest = { turn: 0, start: 0 };
  for (let start = 0; start <= BEND_SEARCH; start += BEND_SEARCH_STEP) {
    const turn = normalizeAngle(roadHeading(start + BEND_LENGTH) - roadHeading(start));
    // Prefer the nearest of near-equal bends so "starting N m ahead" counts down.
    if (Math.abs(turn) > Math.abs(sharpest.turn) + 0.02) sharpest = { turn, start };
  }
  const horizon = BEND_SEARCH + BEND_LENGTH;
  const bendAhead =
    degrees(sharpest.turn) < STRAIGHT_DEGREES
      ? `the road is straight for the next ${horizon} m`
      : `the sharpest bend in the next ${horizon} m turns ${degrees(sharpest.turn)}° to the ${side(sharpest.turn)} within ${BEND_LENGTH} m, starting ${sharpest.start} m ahead`;

  return {
    speed_kmh: Math.round(pose.speed * 3.6),
    on_tarmac: nearest.dist <= ON_TARMAC_DIST,
    car_position: `${Math.abs(lateral).toFixed(1)} m ${side(lateral)} of the road centre line; the tarmac ends ${ROAD_HALF_WIDTH} m from the centre on each side`,
    nose_direction: `${degrees(noseError)}° to the ${side(noseError)} of the road direction`,
    road_ahead: roadAhead,
    bend_ahead: bendAhead,
  };
}

/**
 * The two judgments, asked together in one request. The cornering guide is
 * derived from the Medium grip model (turn radius ≈ v(1 + 0.015v) / 1.8) with a
 * margin for decision lag; retune it with the physics.
 */
export const JEV_QUESTIONS = {
  pedal: {
    type: "choice" as const,
    instructions: {
      goal: "Drive the lap as fast as possible without running off the tarmac. Top speed is 324 km/h.",
      cornering_guide: [
        "A bend turning 60° or more within 40 m can be taken at up to 140 km/h.",
        "A bend turning about 40° within 40 m can be taken at up to 190 km/h.",
        "A bend turning about 25° within 40 m can be taken at up to 250 km/h.",
        "A bend turning 15° or less within 40 m can be taken at full speed.",
        "Braking from 300 km/h down to 150 km/h takes about 70 m, so brake early for a sharp bend when going fast.",
      ],
      question:
        "Given `speed_kmh` and `bend_ahead`, should the driver brake or accelerate right now?",
    },
    criteria: {
      brake:
        "Brake: the car is faster than `cornering_guide` allows for the bend ahead and it is close enough that the driver must slow down now.",
      accelerate:
        "Accelerate: the car is at or below the speed `cornering_guide` allows for the bend ahead, or the bend is still far enough away to keep accelerating.",
    },
  },
  steer: {
    type: "choice" as const,
    instructions:
      "Which way should the driver turn the steering wheel right now so the car points at the road centre ahead in `road_ahead`?",
    criteria: {
      left: "Left: the road centre ahead lies to the left of where the car is pointing.",
      right: "Right: the road centre ahead lies to the right of where the car is pointing.",
    },
  },
};

/** Throttle, brake and steer in the client's CarInput shape. */
export interface JevInput {
  throttle: number;
  brake: number;
  steer: number;
}

/**
 * The pedal is Jev's pick (full throttle or full brake); the steering amount is
 * how sure Jev is: a confident "left" turns harder than a 55/45 one, like
 * holding A longer.
 */
export function jevInput(decision: JevDecision): JevInput {
  const accelerate = decision.accelerate >= 0.5;
  return {
    throttle: accelerate ? 1 : 0,
    brake: accelerate ? 0 : 1,
    steer: Math.max(-1, Math.min(1, 2 * decision.left - 1)),
  };
}
