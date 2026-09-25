import {
  BARRIER_OFFSET,
  DEFAULT_DIFFICULTY,
  type Difficulty,
  MAX_SPEED_MS,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type TrackSample,
} from "@racing/shared";
import { carContact, type CarObstacle } from "./car-collision";
import type { CarInput } from "./input";
import { lerpPose, type Pose } from "./pose-interpolation";

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
/** Bounciness of car-to-car hits: 0 kills the closing speed, 1 is a perfect bounce. */
const CAR_RESTITUTION = 0.3;

/** Shared by every `advance` without other cars, so a solo car allocates nothing per frame. */
const NO_OBSTACLES: readonly CarObstacle[] = [];

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
  private readonly previousPose: Pose = { x: 0, z: 0, heading: 0, speed: 0 };
  private readonly renderPose: Pose = { x: 0, z: 0, heading: 0, speed: 0 };
  private readonly tuning: SurfaceTuning;
  /** A second car that `predict` steps forward, allocated on first use. */
  private scratch: CarPhysics | null = null;

  constructor(
    private readonly difficulty: Difficulty = DEFAULT_DIFFICULTY,
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
    this.rememberPose();
  }

  private rememberPose(): void {
    this.previousPose.x = this.x;
    this.previousPose.z = this.z;
    this.previousPose.heading = this.heading;
    this.previousPose.speed = this.speed;
  }

  /** Seconds of frame time not yet simulated: the physical state trails the latest frame by this. */
  get backlog(): number {
    return this.stepAccumulator;
  }

  /**
   * Render one fixed step behind simulation, smoothly between completed steps.
   * The returned object is reused; network and lap logic must use physical state.
   */
  getRenderPose(): Readonly<Pose> {
    const amount = Math.min(1, this.stepAccumulator / PHYSICS_STEP);
    return lerpPose(this.previousPose, this, amount, this.renderPose);
  }

  /**
   * Pass the raw frame delta so ordinary stalls catch up to the lap clock.
   * `obstacles` are the other players' cars as drawn this frame; Pacers never collide.
   */
  advance(
    elapsed: number,
    input: CarInput,
    obstacles: readonly CarObstacle[] = NO_OBSTACLES,
  ): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    this.stepAccumulator = Math.min(this.stepAccumulator + elapsed, MAX_ACCUMULATED_TIME);
    for (
      let steps = 0;
      steps < MAX_STEPS_PER_FRAME && this.stepAccumulator >= PHYSICS_STEP;
      steps++
    ) {
      this.update(PHYSICS_STEP, input);
      this.collide(obstacles);
      this.stepAccumulator -= PHYSICS_STEP;
    }
  }

  /**
   * Where this car will be after holding `input` for `seconds`, stepped on the
   * same fixed-step path as `advance` (without other cars) by a scratch copy, so
   * this car is left untouched. A Jev Live Run asks Jev about this pose, since
   * Jev's answer only lands after the round trip (ADR-0009).
   */
  predict(seconds: number, input: CarInput): Pose {
    const copy = (this.scratch ??= new CarPhysics(this.difficulty, this.samples));
    copy.x = this.x;
    copy.z = this.z;
    copy.heading = this.heading;
    copy.speed = this.speed;
    copy.onTrack = this.onTrack;
    copy.centerIndex = this.centerIndex;
    copy.touchingWall = this.touchingWall;
    const steps = Math.max(0, Math.round(seconds / PHYSICS_STEP));
    for (let step = 0; step < steps; step++) copy.update(PHYSICS_STEP, input);
    return { x: copy.x, z: copy.z, heading: copy.heading, speed: copy.speed };
  }

  /** Direct integration is reserved for fixed-dt simulation and training callers. */
  update(dt: number, input: CarInput): void {
    this.rememberPose();
    this.applyPedals(dt, input);
    this.applySurface(dt);
    this.move(dt, input.steer);
    this.resolveBarrier();
  }

  private applyPedals(dt: number, input: CarInput): void {
    if (input.throttle > 0) this.speed += this.tuning.engineAccel * input.throttle * dt;
    if (input.brake > 0) this.speed -= BRAKE_DECEL * input.brake * dt;
    if (input.throttle === 0 && input.brake === 0) {
      this.speed = approachRest(this.speed, COAST_DECEL * dt);
    }
    this.speed -= this.speed * Math.abs(this.speed) * DRAG * dt;
  }

  private applySurface(dt: number): void {
    const nearest = nearestCenterline(this.x, this.z, this.samples);
    this.onTrack = nearest.dist <= ROAD_HALF_WIDTH + 0.6;
    const limit = this.onTrack ? this.tuning.maxSpeed : this.tuning.grassMaxSpeed;
    if (this.speed > limit) this.speed = Math.max(limit, this.speed - GRASS_DECEL * dt);
    if (!this.onTrack && this.speed !== 0) {
      this.speed = approachRest(this.speed, this.tuning.grassFriction * dt);
    }
    if (this.speed < -REVERSE_MAX_SPEED) this.speed = -REVERSE_MAX_SPEED;
  }

  private move(dt: number, steer: number): void {
    const grip = Math.min(Math.abs(this.speed) / 14, 1) / (1 + Math.abs(this.speed) * 0.015);
    this.heading += steer * STEER_RATE * grip * Math.sign(this.speed || 1) * dt;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
  }

  /**
   * Each client only moves its own car (ADR-0008): this car leaves the overlap and
   * takes its half of an equal-mass impulse, and the other player's client
   * resolves their car against this one as it draws it. Only the component along
   * the heading survives, since the model has no sideways velocity; a side-on
   * shove still moves the car through the positional push.
   */
  private collide(obstacles: readonly CarObstacle[]): void {
    let hit = false;
    for (const other of obstacles) {
      const contact = carContact(this, other);
      if (!contact) continue;
      hit = true;
      const { nx, nz, depth } = contact;
      this.x += nx * depth;
      this.z += nz * depth;
      const forwardX = Math.sin(this.heading);
      const forwardZ = Math.cos(this.heading);
      // The other car's speed is reported by its client; never trust it past this Room's limits.
      const otherSpeed = this.limitSpeed(other.speed);
      const closing =
        (forwardX * this.speed - Math.sin(other.heading) * otherSpeed) * nx +
        (forwardZ * this.speed - Math.cos(other.heading) * otherSpeed) * nz;
      if (closing >= 0) continue;
      const impulse = (-(1 + CAR_RESTITUTION) / 2) * closing;
      this.speed += impulse * (forwardX * nx + forwardZ * nz);
    }
    if (!hit) return;
    // A shove must never outrun the Room's top speed, or the lap reads as implausible.
    this.speed = this.limitSpeed(this.speed);
    this.resolveBarrier();
  }

  private limitSpeed(speed: number): number {
    return Math.min(Math.max(speed, -REVERSE_MAX_SPEED), this.tuning.maxSpeed);
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
  return Math.abs(speed) <= deceleration ? 0 : speed - Math.sign(speed) * deceleration;
}
