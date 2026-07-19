import {
  BARRIER_OFFSET,
  DEFAULT_DIFFICULTY,
  type Difficulty,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type TrackSample,
} from "@racing/shared";
import type { CarInput } from "./input";

/**
 * The four knobs that vary per difficulty (see CONTEXT.md / ADR 0001). Medium
 * equals the pre-feature tuning; Easy is slow & forgiving, Hard fast & punishing.
 */
interface DifficultyPhysics {
  /** Top speed on track, m/s. */
  maxSpeed: number;
  /** Engine acceleration, m/s². */
  engineAccel: number;
  /** Hard speed cap while any wheel is on grass, m/s. */
  grassMaxSpeed: number;
  /** Constant deceleration applied every frame on grass, m/s². */
  grassFriction: number;
}

const DIFFICULTY_PHYSICS: Record<Difficulty, DifficultyPhysics> = {
  easy: { maxSpeed: 52, engineAccel: 38, grassMaxSpeed: 24, grassFriction: 1.5 },
  medium: { maxSpeed: 90, engineAccel: 65, grassMaxSpeed: 9, grassFriction: 6 },
  hard: { maxSpeed: 110, engineAccel: 80, grassMaxSpeed: 5, grassFriction: 10 },
};

// Fixed across all difficulties.
const BRAKE_DECEL = 38;
const REVERSE_MAX_SPEED = 14;
const COAST_DECEL = 5;
const DRAG = 0.01; // quadratic drag coefficient
const GRASS_DECEL = 110; // extra slowdown while above grass speed limit
const STEER_RATE = 1.8; // rad/s at full grip

/**
 * Fixed physics integration step. All simulation advances are quantised to
 * this size so the trajectory is frame-rate-independent: a 30 fps client and
 * a 144 fps client accumulate the same number of steps per unit time and
 * therefore follow identical paths for identical inputs.
 */
export const PHYSICS_STEP = 1 / 120;

/** Cars are physically clamped just inside the barrier wall. */
const WALL_DIST = ROAD_HALF_WIDTH + BARRIER_OFFSET - 1.2;

export class CarPhysics {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  onTrack = true;
  /** Nearest centerline sample index, updated every frame (used by camera/autopilot). */
  centerIndex = 0;
  private touchingWall = false;
  private readonly tuning: DifficultyPhysics;
  private readonly samples: TrackSample[];
  private _accum = 0;

  constructor(difficulty: Difficulty = DEFAULT_DIFFICULTY, samples: TrackSample[]) {
    this.tuning = DIFFICULTY_PHYSICS[difficulty];
    this.samples = samples;
  }

  spawnAtSample(index: number, lateralOffset: number): void {
    const s = this.samples[index];
    // Left-pointing normal of the direction of travel.
    const nx = -s.dirZ;
    const nz = s.dirX;
    this.x = s.x + nx * lateralOffset;
    this.z = s.z + nz * lateralOffset;
    this.heading = Math.atan2(s.dirX, s.dirZ);
    this.speed = 0;
    this.centerIndex = index;
    this._accum = 0;
  }

  /**
   * Advance the simulation by `elapsed` seconds using fixed-step integration.
   * Sub-step remainders are carried over to the next call, ensuring the total
   * number of physics steps is deterministic regardless of frame rate.
   * Use this from the game loop; call update() directly only from harness/tests
   * that already supply a fixed dt.
   */
  advance(elapsed: number, input: CarInput): void {
    this._accum += elapsed;
    while (this._accum >= PHYSICS_STEP) {
      this.update(PHYSICS_STEP, input);
      this._accum -= PHYSICS_STEP;
    }
  }

  update(dt: number, input: CarInput): void {
    // Throttle / brake / coast
    if (input.throttle > 0) this.speed += this.tuning.engineAccel * input.throttle * dt;
    if (input.brake > 0) this.speed -= BRAKE_DECEL * input.brake * dt;
    if (input.throttle === 0 && input.brake === 0) {
      const c = COAST_DECEL * dt;
      this.speed = Math.abs(this.speed) <= c ? 0 : this.speed - Math.sign(this.speed) * c;
    }
    this.speed -= this.speed * Math.abs(this.speed) * DRAG * dt;

    // Surface limits
    const before = nearestCenterline(this.x, this.z, this.samples);
    this.onTrack = before.dist <= ROAD_HALF_WIDTH + 0.6;
    const limit = this.onTrack ? this.tuning.maxSpeed : this.tuning.grassMaxSpeed;
    if (this.speed > limit) this.speed = Math.max(limit, this.speed - GRASS_DECEL * dt);
    if (!this.onTrack && this.speed !== 0) {
      // Continuous grass drag, independent of the speed cap, so even slow cars feel the mud.
      const f = this.tuning.grassFriction * dt;
      this.speed = Math.abs(this.speed) <= f ? 0 : this.speed - Math.sign(this.speed) * f;
    }
    if (this.speed < -REVERSE_MAX_SPEED) this.speed = -REVERSE_MAX_SPEED;

    // Steering: no grip at standstill, reduced authority at high speed
    const grip = Math.min(Math.abs(this.speed) / 14, 1) / (1 + Math.abs(this.speed) * 0.015);
    this.heading += input.steer * STEER_RATE * grip * Math.sign(this.speed || 1) * dt;

    // Integrate position
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // Barrier collision: clamp to the wall, pay a one-time speed penalty per contact
    const after = nearestCenterline(this.x, this.z, this.samples);
    this.centerIndex = after.index;
    if (after.dist > WALL_DIST) {
      const s = this.samples[after.index];
      const inv = 1 / after.dist;
      this.x = s.x + (this.x - s.x) * inv * WALL_DIST;
      this.z = s.z + (this.z - s.z) * inv * WALL_DIST;
      if (!this.touchingWall) {
        this.speed *= 0.45;
        this.touchingWall = true;
      }
    } else if (after.dist < WALL_DIST - 0.5) {
      this.touchingWall = false;
    }
  }
}
