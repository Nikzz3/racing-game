// How a car brakes and turns, the same on every Difficulty. `CarPhysics`
// (client/src/game/physics.ts) integrates these; Jev's speed check
// (shared/src/jev.ts) reads them to work out how fast the car can go, so the
// two can never drift apart. Keep them aligned with the trained policy
// (rl/physics.py).

/** Full-brake deceleration, m/s². */
export const BRAKE_DECEL = 38;
/** Quadratic drag: the car loses DRAG · v² m/s² on top of the pedals. */
export const DRAG = 0.01;
/** Heading change at full lock and full grip, rad/s. */
export const STEER_RATE = 1.8;
/** Steering grip grows with speed up to this speed (m/s)… */
export const FULL_GRIP_SPEED = 14;
/** …then fades as 1 / (1 + GRIP_FADE · v). */
export const GRIP_FADE = 0.015;

/** The share (0–1) of STEER_RATE the wheel delivers at `speed` m/s. */
export function steeringGrip(speed: number): number {
  const v = Math.abs(speed);
  return Math.min(v / FULL_GRIP_SPEED, 1) / (1 + v * GRIP_FADE);
}

/**
 * The fastest speed (m/s) at which full lock still turns the car on a circle of
 * `radius` metres: at speed v ≥ FULL_GRIP_SPEED the full-lock radius is
 * v · (1 + GRIP_FADE · v) / STEER_RATE, solved here for v.
 */
export function speedForTurnRadius(radius: number): number {
  return (Math.sqrt(1 + 4 * GRIP_FADE * STEER_RATE * radius) - 1) / (2 * GRIP_FADE);
}
