import {
  CHECKPOINT_RADIUS,
  MAX_SPEED_MS,
  ROAD_HALF_WIDTH,
  SUNSET_RIDGE,
  TRACK_DIVISIONS,
  type Difficulty,
  type Track,
  type TrackSample,
} from "@racing/shared";
import type { CarInput } from "./input";
import { CarPhysics } from "./physics";

const DT = 1 / 60;
/** The fixed spawn every AI lap starts from, about 45 m before the start line. */
export const SPAWN_SAMPLE = TRACK_DIVISIONS - 14;
const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;
/**
 * How many centerline samples ahead the autopilot aims for. Kept low enough that
 * the follower hugs the centerline through tight sections (Stormhaven's esse
 * snake) instead of chord-cutting across the apexes onto the grass — at a larger
 * lookahead it strays >8 units off those gates and can't clear CHECKPOINT_RADIUS.
 */
const AUTOPILOT_LOOKAHEAD = 8;

export interface StepState {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export interface RunResult {
  lapTimeMs: number;
  steps: number;
  trajectory: StepState[];
  /** Input applied at each step — same length as trajectory; enables replay via replayInputs. */
  inputs: CarInput[];
}

interface RunOptions {
  difficulty?: Difficulty;
  maxSteps?: number;
  track?: Track;
}

/**
 * Mirrors the server's timing.ts checkpoint logic in simulation step counts
 * rather than wall-clock time, so runs are fully deterministic.
 */
export class CheckpointTracker {
  next = 0;
  private lapStartStep: number | null = null;

  constructor(private readonly checkpoints: { x: number; z: number }[]) {}

  /** Returns the lap time when this crossing completes a lap. */
  update(x: number, z: number, step: number): number | null {
    const cp = this.checkpoints[this.next];
    const dx = x - cp.x;
    const dz = z - cp.z;
    if (dx * dx + dz * dz > R2) return null;

    let lapMs: number | null = null;
    if (this.next === 0) {
      if (this.lapStartStep !== null) lapMs = (step - this.lapStartStep) * DT * 1000;
      this.lapStartStep = step;
    }
    this.next = (this.next + 1) % this.checkpoints.length;
    return lapMs;
  }
}

/** Rule-based centerline follower. */
export function autopilotInput(
  car: CarPhysics,
  samples: TrackSample[],
  lookahead = AUTOPILOT_LOOKAHEAD,
): CarInput {
  const target = samples[(car.centerIndex + lookahead) % samples.length];
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

/** Drives from the fixed spawn until a valid lap completes, or null within maxSteps. */
function runLap(
  { difficulty = "medium", maxSteps = 36000, track = SUNSET_RIDGE }: RunOptions,
  chooseInput: (car: CarPhysics, samples: TrackSample[]) => CarInput,
): RunResult | null {
  const car = new CarPhysics(difficulty, track.samples);
  car.spawnAtSample(SPAWN_SAMPLE, 0);
  const tracker = new CheckpointTracker(track.checkpoints);
  const trajectory: StepState[] = [];
  const inputs: CarInput[] = [];
  for (let step = 0; step < maxSteps; step++) {
    const input = chooseInput(car, track.samples);
    inputs.push(input);
    car.update(DT, input);
    trajectory.push(snapshot(car));
    const lapMs = tracker.update(car.x, car.z, step);
    if (lapMs !== null) return { lapTimeMs: lapMs, steps: step + 1, trajectory, inputs };
  }
  return null;
}

export function runAutopilotLap(options: RunOptions = {}): RunResult | null {
  return runLap(options, (car, samples) => autopilotInput(car, samples));
}

/**
 * Replays an input sequence from the fixed spawn and emits the per-step state
 * trajectory. lapTimeMs is set when (and if) a valid lap completes.
 */
export function replayInputs(
  inputs: CarInput[],
  { difficulty = "medium", track = SUNSET_RIDGE }: Omit<RunOptions, "maxSteps"> = {},
): { trajectory: StepState[]; lapTimeMs: number | null } {
  const car = new CarPhysics(difficulty, track.samples);
  car.spawnAtSample(SPAWN_SAMPLE, 0);
  const tracker = new CheckpointTracker(track.checkpoints);
  const trajectory: StepState[] = [];
  let lapTimeMs: number | null = null;
  inputs.forEach((input, step) => {
    car.update(DT, input);
    trajectory.push(snapshot(car));
    lapTimeMs ??= tracker.update(car.x, car.z, step);
  });
  return { trajectory, lapTimeMs };
}

function snapshot(car: CarPhysics): StepState {
  return { x: car.x, z: car.z, heading: car.heading, speed: car.speed };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------------------------------------------------------------------------
// Policy forward pass (mirrors Python env._compute_obs + train.py export)
// ---------------------------------------------------------------------------

/** Exported policy weights from rl/train.py → rl/policy.json. */
export interface PolicyWeights {
  obs_mean: number[];
  obs_var: number[];
  net_arch: number[];
  activation: string;
  layers: Array<{ weight: number[][]; bias: number[] }>;
}

// Observation normalization matches the Python training env, which used the
// medium top speed (90 at training time). Sourced from the shared table
// (ADR-0005); if MAX_SPEED_MS.medium is ever retuned, the policy must be
// retrained or this normalization pinned to the training-time value.
const MEDIUM_MAX_SPEED = MAX_SPEED_MS.medium;
const POLICY_LOOKAHEADS = [5, 10, 20, 40] as const;

/** The 7-dim observation vector; mirrors SunsetRidgeEnv._compute_obs in env.py. */
function computePolicyObs(car: CarPhysics, samples: TrackSample[]): number[] {
  const s = samples[car.centerIndex];
  const dx = car.x - s.x;
  const dz = car.z - s.z;
  // Signed lateral: dirX*dz - dirZ*dx > 0 ⟹ car is left of track direction
  const lateral = (s.dirX * dz - s.dirZ * dx) / ROAD_HALF_WIDTH;
  const trackHeading = Math.atan2(s.dirX, s.dirZ);
  const headingErr = normalizeAngle(car.heading - trackHeading) / Math.PI;
  const speedNorm = car.speed / MEDIUM_MAX_SPEED;
  const curvatures = POLICY_LOOKAHEADS.map((offset) => {
    const ahead = samples[(car.centerIndex + offset) % samples.length];
    const aheadH = Math.atan2(ahead.dirX, ahead.dirZ);
    return normalizeAngle(aheadH - trackHeading) / Math.PI;
  });
  return [lateral, headingErr, speedNorm, ...curvatures].map((v) => Math.max(-3, Math.min(3, v)));
}

/** VecNormalize stats, then tanh-MLP, then the action-space clip. */
export function policyForward(obs: number[], policy: PolicyWeights): number[] {
  // Clamp to [-5, 5] like VecNormalize clip_obs=5.0 in train.py; without it the
  // network sees out-of-distribution values when the car deviates sharply.
  let x = obs.map((v, i) => {
    const normalized = (v - policy.obs_mean[i]) / Math.sqrt(policy.obs_var[i] + 1e-8);
    return Math.max(-5, Math.min(5, normalized));
  });
  const numLayers = policy.layers.length;
  for (let i = 0; i < numLayers; i++) {
    const { weight, bias } = policy.layers[i];
    const prev = x;
    x = Array.from<number>({ length: weight.length });
    const hidden = i < numLayers - 1;
    for (let j = 0; j < weight.length; j++) {
      const row = weight[j];
      // Keep the trained summation order: add the bias only after the dot
      // product. Avoid per-neuron callbacks and the extra activation array
      // while baking the full Reference Lap on the browser's main thread.
      let sum = 0;
      for (let k = 0; k < row.length; k++) sum += row[k] * prev[k];
      const value = sum + bias[j];
      x[j] = hidden ? Math.tanh(value) : value;
    }
  }
  return x.map((v) => Math.max(-1, Math.min(1, v)));
}

/** Runs the exported policy against the real CarPhysics from the fixed spawn. */
export function runPolicyLap(policy: PolicyWeights, options: RunOptions = {}): RunResult | null {
  return runLap(options, (car, samples) => {
    const [steer, longitudinal] = policyForward(computePolicyObs(car, samples), policy);
    return {
      steer,
      throttle: Math.max(0, longitudinal),
      brake: Math.max(0, -longitudinal),
    };
  });
}
