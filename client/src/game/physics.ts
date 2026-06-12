import {
  BARRIER_OFFSET,
  nearestCenterline,
  ROAD_HALF_WIDTH,
  TRACK_SAMPLES,
} from "@racing/shared";
import type { CarInput } from "./input";

const MAX_SPEED = 90; // m/s, ~324 km/h
const GRASS_MAX_SPEED = 9;
const ENGINE_ACCEL = 65;
const BRAKE_DECEL = 38;
const REVERSE_MAX_SPEED = 14;
const COAST_DECEL = 5;
const DRAG = 0.01; // quadratic drag coefficient
const GRASS_DECEL = 110; // extra slowdown while above grass speed limit
const GRASS_FRICTION = 6; // constant deceleration while any wheel is on grass
const STEER_RATE = 1.8; // rad/s at full grip

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

  spawnAtSample(index: number, lateralOffset: number): void {
    const s = TRACK_SAMPLES[index];
    // Left-pointing normal of the direction of travel.
    const nx = -s.dirZ;
    const nz = s.dirX;
    this.x = s.x + nx * lateralOffset;
    this.z = s.z + nz * lateralOffset;
    this.heading = Math.atan2(s.dirX, s.dirZ);
    this.speed = 0;
    this.centerIndex = index;
  }

  update(dt: number, input: CarInput): void {
    // Throttle / brake / coast
    if (input.throttle > 0) this.speed += ENGINE_ACCEL * input.throttle * dt;
    if (input.brake > 0) this.speed -= BRAKE_DECEL * input.brake * dt;
    if (input.throttle === 0 && input.brake === 0) {
      const c = COAST_DECEL * dt;
      this.speed = Math.abs(this.speed) <= c ? 0 : this.speed - Math.sign(this.speed) * c;
    }
    this.speed -= this.speed * Math.abs(this.speed) * DRAG * dt;

    // Surface limits
    const before = nearestCenterline(this.x, this.z);
    this.onTrack = before.dist <= ROAD_HALF_WIDTH + 0.6;
    const limit = this.onTrack ? MAX_SPEED : GRASS_MAX_SPEED;
    if (this.speed > limit) this.speed = Math.max(limit, this.speed - GRASS_DECEL * dt);
    if (!this.onTrack && this.speed !== 0) {
      // Continuous grass drag, independent of the speed cap, so even slow cars feel the mud.
      const f = GRASS_FRICTION * dt;
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
    const after = nearestCenterline(this.x, this.z);
    this.centerIndex = after.index;
    if (after.dist > WALL_DIST) {
      const s = TRACK_SAMPLES[after.index];
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
