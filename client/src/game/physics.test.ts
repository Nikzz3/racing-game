import { describe, it, expect } from "vitest";
import { DEFAULT_DIFFICULTY, SUNSET_RIDGE, TRACK_DIVISIONS } from "@racing/shared";
import { CarPhysics, PHYSICS_STEP, MAX_STEPS_PER_FRAME } from "./physics";
import type { CarInput } from "./input";

const FULL_THROTTLE: CarInput = { throttle: 1, brake: 0, steer: 0 };
const STEER_GRASS: CarInput = { throttle: 1, brake: 0, steer: 1 };

function advanceCar(
  car: CarPhysics,
  fps: number,
  durationS: number,
  input: CarInput
): void {
  const frameDt = 1 / fps;
  const frames = Math.round(durationS * fps);
  for (let i = 0; i < frames; i++) {
    car.advance(frameDt, input);
  }
}

describe("CarPhysics.advance — fixed-step accumulator", () => {
  it("PHYSICS_STEP is exported and equals 1/120", () => {
    expect(PHYSICS_STEP).toBeCloseTo(1 / 120, 10);
  });

  it("advance steps the car forward (throttle increases speed)", () => {
    const car = new CarPhysics(DEFAULT_DIFFICULTY, SUNSET_RIDGE.samples);
    car.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    const before = car.speed;
    car.advance(PHYSICS_STEP, FULL_THROTTLE);
    expect(car.speed).toBeGreaterThan(before);
  });

  it("advance(0, input) makes no change", () => {
    const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    const before = { x: car.x, z: car.z, speed: car.speed };
    car.advance(0, FULL_THROTTLE);
    expect(car.x).toBe(before.x);
    expect(car.z).toBe(before.z);
    expect(car.speed).toBe(before.speed);
  });

  it("produces frame-rate-independent speed on track: 30fps vs 144fps", () => {
    const car30 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car30.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    advanceCar(car30, 30, 3, FULL_THROTTLE);

    const car144 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car144.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    advanceCar(car144, 144, 3, FULL_THROTTLE);

    expect(car30.speed).toBeCloseTo(car144.speed, 4);
  });

  it("produces frame-rate-independent position on track: 30fps vs 144fps", () => {
    const car30 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car30.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    advanceCar(car30, 30, 3, FULL_THROTTLE);

    const car144 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car144.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    advanceCar(car144, 144, 3, FULL_THROTTLE);

    // FP accumulation can leave a one-step residual (~0.1 m); the key property
    // is "much closer than variable-dt" (the original bug produced ~4 m divergence).
    expect(Math.abs(car30.x - car144.x)).toBeLessThan(0.5);
    expect(Math.abs(car30.z - car144.z)).toBeLessThan(0.5);
  });

  it("produces frame-rate-independent speed on grass: 30fps vs 144fps", () => {
    // Steer hard with throttle so the car eventually leaves the road.
    const car30 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car30.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    advanceCar(car30, 30, 5, STEER_GRASS);

    const car144 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car144.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    advanceCar(car144, 144, 5, STEER_GRASS);

    expect(car30.speed).toBeCloseTo(car144.speed, 4);
  });

  it("accumulates sub-step elapsed time across advance() calls", () => {
    // Two advances of PHYSICS_STEP/2 should equal one advance of PHYSICS_STEP.
    const car1 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car1.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    car1.advance(PHYSICS_STEP, FULL_THROTTLE);

    const car2 = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car2.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    car2.advance(PHYSICS_STEP / 2, FULL_THROTTLE);
    car2.advance(PHYSICS_STEP / 2, FULL_THROTTLE);

    expect(car1.speed).toBeCloseTo(car2.speed, 10);
    expect(car1.x).toBeCloseTo(car2.x, 10);
    expect(car1.z).toBeCloseTo(car2.z, 10);
  });

  it("substep cap: a huge frame delta runs at most MAX_STEPS_PER_FRAME steps", () => {
    // A 10-second stall would normally drain 10 / PHYSICS_STEP = 1200 steps.
    // The cap should clamp it to MAX_STEPS_PER_FRAME steps.
    const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car.spawnAtSample(TRACK_DIVISIONS - 14, 0);

    // Advance one capped step first so stepAccumulator carries a known residual.
    const cappedCar = new CarPhysics("medium", SUNSET_RIDGE.samples);
    cappedCar.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    cappedCar.advance(MAX_STEPS_PER_FRAME * PHYSICS_STEP, FULL_THROTTLE);

    // A 10 s stall should produce the same result as MAX_STEPS_PER_FRAME steps.
    car.advance(10, FULL_THROTTLE);
    expect(car.speed).toBeCloseTo(cappedCar.speed, 6);
    expect(car.x).toBeCloseTo(cappedCar.x, 6);
    expect(car.z).toBeCloseTo(cappedCar.z, 6);
  });
});
