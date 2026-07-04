import {
  CHECKPOINTS,
  CHECKPOINT_RADIUS,
  NUM_CHECKPOINTS,
  TRACK_DIVISIONS,
  TRACK_SAMPLES,
  type Difficulty,
} from '@racing/shared';
import type { CarInput } from './input';
import { CarPhysics } from './physics';

const DT = 1 / 60;
const SPAWN_SAMPLE = TRACK_DIVISIONS - 14;
const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;
/** How many centerline samples ahead the autopilot aims for. */
const AUTOPILOT_LOOKAHEAD = 12;

export interface StepState {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Capture the car's current pose as a trajectory step. */
function snapshot(car: CarPhysics): StepState {
  return { x: car.x, z: car.z, heading: car.heading, speed: car.speed };
}

export interface RunResult {
  lapTimeMs: number;
  steps: number;
  trajectory: StepState[];
  /** Input applied at each step — same length as trajectory; enables replay via replayInputs. */
  inputs: CarInput[];
}

/**
 * Tracks checkpoint progress and detects completed valid laps.
 * Mirrors the server's timing.ts logic but operates in simulation step counts
 * rather than wall-clock time, so tests are fully deterministic.
 */
export class CheckpointTracker {
  next = 0;
  private lapStartStep: number | null = null;

  update(x: number, z: number, step: number): number | null {
    const cp = CHECKPOINTS[this.next];
    const dx = x - cp.x;
    const dz = z - cp.z;
    if (dx * dx + dz * dz > R2) return null;

    let lapMs: number | null = null;
    if (this.next === 0) {
      if (this.lapStartStep !== null) {
        lapMs = ((step - this.lapStartStep) * DT) * 1000;
      }
      this.lapStartStep = step;
    }
    this.next = (this.next + 1) % NUM_CHECKPOINTS;
    return lapMs;
  }
}

/** Rule-based autopilot: centerline follower with a fixed lookahead. */
export function autopilotInput(car: CarPhysics): CarInput {
  const n = TRACK_SAMPLES.length;
  const target = TRACK_SAMPLES[(car.centerIndex + AUTOPILOT_LOOKAHEAD) % n];
  const desired = Math.atan2(target.x - car.x, target.z - car.z);
  let diff = (desired - car.heading) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return {
    steer: Math.max(-1, Math.min(1, diff * 2.5)),
    throttle: Math.abs(diff) > 0.5 && car.speed > 18 ? 0 : 1,
    brake: Math.abs(diff) > 0.9 && car.speed > 12 ? 1 : 0,
  };
}

/**
 * Drive the autopilot from the fixed spawn until a valid lap completes.
 * Returns null if the lap is not completed within maxSteps.
 */
export function runAutopilotLap(
  options: { difficulty?: Difficulty; maxSteps?: number } = {}
): RunResult | null {
  const { difficulty = 'medium', maxSteps = 36000 } = options;
  const car = new CarPhysics(difficulty);
  car.spawnAtSample(SPAWN_SAMPLE, 0);

  const tracker = new CheckpointTracker();
  const trajectory: StepState[] = [];
  const inputs: CarInput[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const input = autopilotInput(car);
    inputs.push(input);
    car.update(DT, input);
    trajectory.push(snapshot(car));

    const lapMs = tracker.update(car.x, car.z, step);
    if (lapMs !== null) {
      return { lapTimeMs: lapMs, steps: step + 1, trajectory, inputs };
    }
  }

  return null;
}

/**
 * Replay an arbitrary input sequence from the fixed spawn and emit the full
 * per-step state trajectory. lapTimeMs is set when (and if) a valid lap completes.
 */
export function replayInputs(
  inputs: CarInput[],
  options: { difficulty?: Difficulty } = {}
): { trajectory: StepState[]; lapTimeMs: number | null } {
  const { difficulty = 'medium' } = options;
  const car = new CarPhysics(difficulty);
  car.spawnAtSample(SPAWN_SAMPLE, 0);

  const tracker = new CheckpointTracker();
  const trajectory: StepState[] = [];
  let lapTimeMs: number | null = null;

  for (let step = 0; step < inputs.length; step++) {
    car.update(DT, inputs[step]);
    trajectory.push(snapshot(car));

    if (lapTimeMs === null) {
      const lapMs = tracker.update(car.x, car.z, step);
      if (lapMs !== null) lapTimeMs = lapMs;
    }
  }

  return { trajectory, lapTimeMs };
}
