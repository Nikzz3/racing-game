// Jev drives (ADR-0009, ADR-0010, ADR-0011): TypeSafe's System One model reads a
// text description of the car and the road ahead and answers two Choice
// questions — brake or accelerate, and steer left, right or nothing. Code owns
// the geometry, the physics (a racing line and a speed check) and the mapping
// from probabilities to pedals; Jev supplies the judgment. The offline recorder
// asks the questions with the developer's API key; the client uses the same
// state builder to show players exactly what Jev saw.

import { MAX_SPEED_MS, type Difficulty } from "./difficulty";
import { BRAKE_DECEL, DRAG, FULL_GRIP_SPEED, speedForTurnRadius } from "./handling";
import { racingLineAhead } from "./racing-line";
import {
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type Track,
  type TrackSample,
  type TrackSlug,
} from "./track";
import type { Variant } from "./variant";

/** Jev drives where its racing line and speed check were validated: Medium, Sunset Ridge. */
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

/**
 * Jev's answers: P(accelerate) against brake; P(left) and P(right), with the
 * rest on leaving the wheel centred ("nothing"); and how sure each pick is.
 */
export interface JevDecision {
  accelerate: number;
  left: number;
  right: number;
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
  speed_check: string;
}

/**
 * Distances (m) along the racing line at which it is described. Jev steers
 * mostly by the second; at 30 m it cut the tight bends in simulation.
 */
const AIM_DISTANCES = [15, 25, 40, 70];
/** The racing-line point the car must be able to turn onto now, this far ahead. */
const TURN_AIM = 30;
/** A bend is measured as the heading change over this many metres of road. */
const BEND_LENGTH = 40;
/** Bend search horizon: starts up to this far ahead are considered. */
const BEND_SEARCH = 150;
const BEND_SEARCH_STEP = 10;
/** Bends gentler than this (rad over BEND_LENGTH) never limit the speed. */
const STRAIGHT_TURN = 0.01;
/**
 * Full-lock speeds are multiplied by this. The limits assume the car turns at
 * full lock exactly along the racing line, which is conservative; 1.2 drove the
 * fastest laps that stayed on the tarmac (ADR-0011).
 */
export const SPEED_MARGIN = 1.2;
/** Braking starts up to one decision late. */
const DECISION_LAG_S = JEV_DECISION_INTERVAL_MS / 1000;
/** Below this the steering fades with speed, so the check never asks Jev to go slower. */
export const MIN_SAFE_SPEED = FULL_GRIP_SPEED;
/** Matches CarPhysics: the car is on the tarmac within this of the centre line. */
const ON_TARMAC_DIST = ROAD_HALF_WIDTH + 0.6;

function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

const degrees = (radians: number): number => Math.round((Math.abs(radians) * 180) / Math.PI);
/** Heading grows when steering left (steer +1 is A / ArrowLeft), so positive angles are left. */
const side = (radians: number): string => (radians >= 0 ? "left" : "right");
const headingOf = (s: TrackSample): number => Math.atan2(s.dirX, s.dirZ);
/** Bearing (rad, + left) of `target` from the car's nose. */
const bearingTo = (pose: JevPose, target: { x: number; z: number }): number =>
  normalizeAngle(Math.atan2(target.x - pose.x, target.z - pose.z) - pose.heading);

/**
 * The nearest centre-line sample, and the racing-line point `metres` further
 * along the racing line from the car's point on it (the line's point at the
 * same index), measured along the line.
 */
function locate(pose: JevPose, track: Track) {
  const nearest = nearestCenterline(pose.x, pose.z, track.samples);
  const ahead = (metres: number): TrackSample => racingLineAhead(track, nearest.index, metres);
  return { nearest, ahead };
}

/**
 * The fastest speed (m/s) from which the car can still make the road ahead with
 * Jev's handling: brake in time for every bend of the racing line in the next
 * BEND_SEARCH + BEND_LENGTH metres, and turn onto the racing line TURN_AIM
 * metres ahead right now at full lock. Code does the arithmetic so Jev does not
 * have to (ADR-0011).
 */
export function jevSafeSpeed(pose: JevPose, track: Track): number {
  const { ahead } = locate(pose, track);
  const topSpeed = MAX_SPEED_MS[JEV_DIFFICULTY];
  let safe = topSpeed;
  for (let start = 0; start <= BEND_SEARCH; start += BEND_SEARCH_STEP) {
    const turn = Math.abs(
      normalizeAngle(headingOf(ahead(start + BEND_LENGTH)) - headingOf(ahead(start))),
    );
    if (turn < STRAIGHT_TURN) continue;
    const bendSpeed = Math.min(topSpeed, speedForTurnRadius(BEND_LENGTH / turn) * SPEED_MARGIN);
    const room = Math.max(0, start - pose.speed * DECISION_LAG_S);
    const decel = BRAKE_DECEL + DRAG * bendSpeed * bendSpeed;
    safe = Math.min(safe, Math.sqrt(bendSpeed * bendSpeed + 2 * decel * room));
  }
  // The arc from the car to the aim point that leaves along the car's heading.
  const aim = ahead(TURN_AIM);
  const chord = Math.hypot(aim.x - pose.x, aim.z - pose.z);
  const radius = chord / (2 * Math.max(1e-3, Math.abs(Math.sin(bearingTo(pose, aim)))));
  safe = Math.min(safe, speedForTurnRadius(radius) * SPEED_MARGIN);
  return Math.max(safe, MIN_SAFE_SPEED);
}

/** Code's verdict on the speed, with the margin in km/h, as Jev reads it. */
function speedCheck(pose: JevPose, track: Track): string {
  const over = Math.round((pose.speed - jevSafeSpeed(pose, track)) * 3.6);
  return over > 0
    ? `too fast: the car is ${over} km/h faster than it can go here and still make the road ahead`
    : `room to spare: the car could go ${-over} km/h faster here and still make the road ahead`;
}

/**
 * Describe the car and the road ahead the way a co-driver would: where the car
 * sits on the road, where it points, where the racing line lies ahead, and
 * whether it is too fast for what is coming. Angles are relative to the car's
 * nose or the road direction, so Jev never has to reason about world coordinates.
 */
export function jevDrivingState(pose: JevPose, track: Track): JevDrivingState {
  const { nearest, ahead } = locate(pose, track);
  const here = track.samples[nearest.index];

  // > 0 when the car is left of the direction of travel. Steering left turns the
  // heading up, which carries the car along (dirZ, -dirX): that is its left.
  const lateral = here.dirZ * (pose.x - here.x) - here.dirX * (pose.z - here.z);
  const noseError = normalizeAngle(pose.heading - headingOf(here));

  const roadAhead = AIM_DISTANCES.map((metres) => {
    const bearing = bearingTo(pose, ahead(metres));
    return `${metres} m ahead the racing line is ${degrees(bearing)}° to the ${side(bearing)} of where the car is pointing`;
  });

  return {
    speed_kmh: Math.round(pose.speed * 3.6),
    on_tarmac: nearest.dist <= ON_TARMAC_DIST,
    car_position: `${Math.abs(lateral).toFixed(1)} m ${side(lateral)} of the road centre line; the tarmac ends ${ROAD_HALF_WIDTH} m from the centre on each side`,
    nose_direction: `${degrees(noseError)}° to the ${side(noseError)} of the road direction`,
    road_ahead: roadAhead,
    speed_check: speedCheck(pose, track),
  };
}

/**
 * The two judgments, asked together in one request. Code has already done the
 * physics in `speed_check`; Jev reads it for the pedal, and reads `road_ahead`
 * for the steering (ADR-0011).
 */
export const JEV_QUESTIONS = {
  pedal: {
    type: "choice" as const,
    instructions: {
      goal: "Drive the lap as fast as possible without running off the tarmac.",
      question: "Given `speed_check`, should the driver brake or accelerate right now?",
    },
    criteria: {
      brake: "Brake: `speed_check` says the car is too fast to make the road ahead.",
      accelerate: "Accelerate: `speed_check` says the car has room to spare.",
    },
  },
  steer: {
    type: "choice" as const,
    instructions:
      "Right now, should the driver turn the steering wheel left or right, or leave it centred, so the car points at the racing line ahead in `road_ahead`?",
    criteria: {
      left: "Left: the racing line ahead lies to the left of where the car is pointing.",
      nothing:
        "Nothing: leave the steering wheel centred: the racing line ahead lies about where the car is already pointing.",
      right: "Right: the racing line ahead lies to the right of where the car is pointing.",
    },
  },
};

/**
 * Steering is Jev's lean, P(left) − P(right), times this. Jev's answers are
 * soft — a few degrees off reads as a lean of about 0.5 — and doubling them
 * holds the racing line more tightly without weaving (ADR-0011).
 */
export const STEER_GAIN = 2;

/** Throttle, brake and steer in the client's CarInput shape. */
export interface JevInput {
  throttle: number;
  brake: number;
  steer: number;
}

/**
 * The pedal is Jev's pick (full throttle or full brake); the steering amount is
 * how sure Jev is of its side, STEER_GAIN · (P(left) − P(right)) clamped to full
 * lock: a confident "left" turns harder than a 55/45 one, like holding A longer,
 * and "nothing" adds no steering.
 */
export function jevInput(decision: JevDecision): JevInput {
  const accelerate = decision.accelerate >= 0.5;
  return {
    throttle: accelerate ? 1 : 0,
    brake: accelerate ? 0 : 1,
    steer: Math.max(-1, Math.min(1, STEER_GAIN * (decision.left - decision.right))),
  };
}
