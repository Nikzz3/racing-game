import {
  BARRIER_OFFSET,
  DEFAULT_DIFFICULTY,
  type Difficulty,
  MAX_SPEED_MS,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type TrackSample,
} from "@racing/shared";
import type { CarInput } from "./input";

interface SurfaceTuning {
  maxSpeed: number;
  engineAccel: number;
  grassMaxSpeed: number;
  grassFriction: number;
}

// Keep these values and the integration order aligned with the trained policy.
// Top speeds also govern the server's lap plausibility validation.
const TUNING: Record<Difficulty, SurfaceTuning> = {
  easy: {
    maxSpeed: MAX_SPEED_MS.easy,
    engineAccel: 38,
    grassMaxSpeed: 24,
    grassFriction: 1.5,
  },
  medium: {
    maxSpeed: MAX_SPEED_MS.medium,
    engineAccel: 65,
    grassMaxSpeed: 9,
    grassFriction: 6,
  },
  hard: {
    maxSpeed: MAX_SPEED_MS.hard,
    engineAccel: 80,
    grassMaxSpeed: 5,
    grassFriction: 10,
  },
};
const BRAKE_DECEL = 38;
const REVERSE_MAX_SPEED = 14;
const COAST_DECEL = 5;
const DRAG = 0.01;
const GRASS_DECEL = 110;
const STEER_RATE = 1.8;
const WALL_DIST = ROAD_HALF_WIDTH + BARRIER_OFFSET - 1.2;

/** Render frames accumulate time; the simulation always consumes fixed steps. */
export const PHYSICS_STEP = 1 / 120;
export const MAX_STEPS_PER_FRAME = 8;
/** Retain ordinary frame hitches, but discard time beyond this backlog. */
export const MAX_ACCUMULATED_TIME = 0.5;

export class CarPhysics {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  onTrack = true;
  centerIndex = 0;

  private touchingWall = false;
  private stepAccumulator = 0;
  private readonly tuning: SurfaceTuning;

  constructor(
    difficulty: Difficulty = DEFAULT_DIFFICULTY,
    private readonly samples: TrackSample[],
  ) {
    this.tuning = TUNING[difficulty];
  }

  spawnAtSample(index: number, lateralOffset: number): void {
    const sample = this.samples[index];
    this.x = sample.x + -sample.dirZ * lateralOffset;
    this.z = sample.z + sample.dirX * lateralOffset;
    this.heading = Math.atan2(sample.dirX, sample.dirZ);
    this.speed = 0;
    this.centerIndex = index;
    this.stepAccumulator = 0;
    this.touchingWall = false;
    this.onTrack = Math.abs(lateralOffset) <= ROAD_HALF_WIDTH + 0.6;
  }

  /** Pass the raw frame delta so ordinary stalls catch up to the lap clock. */
  advance(elapsed: number, input: CarInput): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    this.stepAccumulator = Math.min(
      this.stepAccumulator + elapsed,
      MAX_ACCUMULATED_TIME,
    );
    for (
      let steps = 0;
      steps < MAX_STEPS_PER_FRAME && this.stepAccumulator >= PHYSICS_STEP;
      steps++
    ) {
      this.update(PHYSICS_STEP, input);
      this.stepAccumulator -= PHYSICS_STEP;
    }
  }

  /** Direct integration is reserved for fixed-dt simulation and training callers. */
  update(dt: number, input: CarInput): void {
    this.applyPedals(dt, input);
    this.applySurface(dt);
    this.move(dt, input.steer);
    this.resolveBarrier();
  }

  private applyPedals(dt: number, input: CarInput): void {
    if (input.throttle > 0)
      this.speed += this.tuning.engineAccel * input.throttle * dt;
    if (input.brake > 0) this.speed -= BRAKE_DECEL * input.brake * dt;
    if (input.throttle === 0 && input.brake === 0) {
      this.speed = approachRest(this.speed, COAST_DECEL * dt);
    }
    this.speed -= this.speed * Math.abs(this.speed) * DRAG * dt;
  }

  private applySurface(dt: number): void {
    const nearest = nearestCenterline(this.x, this.z, this.samples);
    this.onTrack = nearest.dist <= ROAD_HALF_WIDTH + 0.6;
    const limit = this.onTrack
      ? this.tuning.maxSpeed
      : this.tuning.grassMaxSpeed;
    if (this.speed > limit)
      this.speed = Math.max(limit, this.speed - GRASS_DECEL * dt);
    if (!this.onTrack && this.speed !== 0) {
      this.speed = approachRest(this.speed, this.tuning.grassFriction * dt);
    }
    if (this.speed < -REVERSE_MAX_SPEED) this.speed = -REVERSE_MAX_SPEED;
  }

  private move(dt: number, steer: number): void {
    const grip =
      Math.min(Math.abs(this.speed) / 14, 1) /
      (1 + Math.abs(this.speed) * 0.015);
    this.heading += steer * STEER_RATE * grip * Math.sign(this.speed || 1) * dt;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
  }

  private resolveBarrier(): void {
    const nearest = nearestCenterline(this.x, this.z, this.samples);
    this.centerIndex = nearest.index;
    if (nearest.dist > WALL_DIST) {
      const sample = this.samples[nearest.index];
      const inverseDistance = 1 / nearest.dist;
      this.x = sample.x + (this.x - sample.x) * inverseDistance * WALL_DIST;
      this.z = sample.z + (this.z - sample.z) * inverseDistance * WALL_DIST;
      if (!this.touchingWall) {
        this.speed *= 0.45;
        this.touchingWall = true;
      }
    } else if (nearest.dist < WALL_DIST - 0.5) {
      this.touchingWall = false;
    }
  }
}

function approachRest(speed: number, deceleration: number): number {
  return Math.abs(speed) <= deceleration
    ? 0
    : speed - Math.sign(speed) * deceleration;
}
