import {
  CHECKPOINT_RADIUS,
  ROAD_HALF_WIDTH,
  SUNSET_RIDGE,
  TRACK_DIVISIONS,
  type Difficulty,
  type Track,
  type TrackSample,
} from '@racing/shared';
import type { CarInput } from './input';
import { CarPhysics } from './physics';

const DT = 1 / 60;
const SPAWN_SAMPLE = TRACK_DIVISIONS - 14;
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
  private readonly checkpoints: { x: number; z: number }[];

  constructor(checkpoints: { x: number; z: number }[]) {
    this.checkpoints = checkpoints;
  }

  update(x: number, z: number, step: number): number | null {
    const cp = this.checkpoints[this.next];
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
    this.next = (this.next + 1) % this.checkpoints.length;
    return lapMs;
  }
}

/** Rule-based autopilot: centerline follower with a fixed lookahead. */
export function autopilotInput(car: CarPhysics, samples: TrackSample[]): CarInput {
  const n = samples.length;
  const target = samples[(car.centerIndex + AUTOPILOT_LOOKAHEAD) % n];
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
  options: { difficulty?: Difficulty; maxSteps?: number; track?: Track } = {}
): RunResult | null {
  const { difficulty = 'medium', maxSteps = 36000, track = SUNSET_RIDGE } = options;
  const car = new CarPhysics(difficulty, track.samples);
  car.spawnAtSample(SPAWN_SAMPLE, 0);

  const tracker = new CheckpointTracker(track.checkpoints);
  const trajectory: StepState[] = [];
  const inputs: CarInput[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const input = autopilotInput(car, track.samples);
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
  options: { difficulty?: Difficulty; track?: Track } = {}
): { trajectory: StepState[]; lapTimeMs: number | null } {
  const { difficulty = 'medium', track = SUNSET_RIDGE } = options;
  const car = new CarPhysics(difficulty, track.samples);
  car.spawnAtSample(SPAWN_SAMPLE, 0);

  const tracker = new CheckpointTracker(track.checkpoints);
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

// Physics constants mirrored from Python env (medium difficulty)
const MEDIUM_MAX_SPEED = 90;
const POLICY_LOOKAHEADS = [5, 10, 20, 40] as const;

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Build the 7-dim observation vector; mirrors SunsetRidgeEnv._compute_obs in env.py. */
function computePolicyObs(car: CarPhysics, samples: TrackSample[]): number[] {
  const s = samples[car.centerIndex];
  const dx = car.x - s.x;
  const dz = car.z - s.z;
  // Signed lateral: dirX*dz - dirZ*dx > 0 ⟹ car is left of track direction
  const lateral = (s.dirX * dz - s.dirZ * dx) / ROAD_HALF_WIDTH;

  const trackHeading = Math.atan2(s.dirX, s.dirZ);
  const headingErr = normalizeAngle(car.heading - trackHeading) / Math.PI;
  const speedNorm = car.speed / MEDIUM_MAX_SPEED;

  const n = samples.length;
  const curvatures = POLICY_LOOKAHEADS.map(offset => {
    const ahead = samples[(car.centerIndex + offset) % n];
    const aheadH = Math.atan2(ahead.dirX, ahead.dirZ);
    return normalizeAngle(aheadH - trackHeading) / Math.PI;
  });

  const raw = [lateral, headingErr, speedNorm, ...curvatures];
  return raw.map(v => Math.max(-3, Math.min(3, v)));
}

/**
 * Run a single forward pass through the exported MLP policy.
 * Applies VecNormalize stats then runs tanh-MLP + output clip.
 */
export function policyForward(obs: number[], policy: PolicyWeights): number[] {
  // Normalize observation using VecNormalize running stats
  let x = obs.map((v, i) => (v - policy.obs_mean[i]) / Math.sqrt(policy.obs_var[i] + 1e-8));

  const numLayers = policy.layers.length;
  for (let i = 0; i < numLayers; i++) {
    const { weight, bias } = policy.layers[i];
    const prev = x;
    // Linear: W @ prev + b
    x = weight.map((row, j) => row.reduce((s, w, k) => s + w * prev[k], 0) + bias[j]);
    if (i < numLayers - 1) {
      x = x.map(v => Math.tanh(v)); // hidden activation
    }
  }
  return x.map(v => Math.max(-1, Math.min(1, v))); // clip to action space
}

/**
 * Run the exported policy against the real TypeScript CarPhysics from the fixed
 * spawn, timing the first valid lap.  Returns null if no lap completed within maxSteps.
 */
export function runPolicyLap(
  policy: PolicyWeights,
  options: { difficulty?: Difficulty; maxSteps?: number; track?: Track } = {}
): RunResult | null {
  const { difficulty = 'medium', maxSteps = 36000, track = SUNSET_RIDGE } = options;
  const car = new CarPhysics(difficulty, track.samples);
  car.spawnAtSample(SPAWN_SAMPLE, 0);

  const tracker = new CheckpointTracker(track.checkpoints);
  const trajectory: StepState[] = [];
  const inputs: CarInput[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const obs = computePolicyObs(car, track.samples);
    const action = policyForward(obs, policy);

    const steer = action[0];
    const longitudinal = action[1];
    const input: CarInput = {
      steer,
      throttle: Math.max(0, longitudinal),
      brake: Math.max(0, -longitudinal),
    };
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
