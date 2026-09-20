import { describe, it, expect } from "vitest";
import { SUNSET_RIDGE, TRACK_DIVISIONS } from "@racing/shared";
import { CarPhysics, PHYSICS_STEP, MAX_STEPS_PER_FRAME, MAX_ACCUMULATED_TIME } from "./physics";
import type { CarInput } from "./input";

const FULL_THROTTLE: CarInput = { throttle: 1, brake: 0, steer: 0 };
const STEER_GRASS: CarInput = { throttle: 1, brake: 0, steer: 1 };

function spawned(): CarPhysics {
  const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
  car.spawnAtSample(TRACK_DIVISIONS - 14, 0);
  return car;
}

/** Each PHYSICS_STEP advance drains exactly one step. */
function runSteps(car: CarPhysics, n: number, input: CarInput): void {
  for (let i = 0; i < n; i++) car.advance(PHYSICS_STEP, input);
}

function driveAt(fps: number, durationS: number, input: CarInput): CarPhysics {
  const car = spawned();
  for (let i = 0; i < Math.round(durationS * fps); i++) car.advance(1 / fps, input);
  return car;
}

function expectSameState(a: CarPhysics, b: CarPhysics, digits: number): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
  expect(a.speed).toBeCloseTo(b.speed, digits);
}

describe("CarPhysics.advance — fixed-step accumulator", () => {
  it("does not extrapolate the rendered car while catching up after a stall", () => {
    const car = spawned();
    car.advance(0.4, FULL_THROTTLE);
    const pose = car.getRenderPose();
    expect(pose.x).toBe(car.x);
    expect(pose.z).toBe(car.z);
    expect(pose.speed).toBe(car.speed);
  });

  it("uses the last injected step when returning from the e2e seam to live rendering", () => {
    const car = spawned();
    for (let step = 0; step < 60; step++) car.update(1 / 60, FULL_THROTTLE);
    const previous = { x: car.x, z: car.z };
    car.update(1 / 60, FULL_THROTTLE);
    car.advance(PHYSICS_STEP / 2, FULL_THROTTLE);
    const pose = car.getRenderPose();
    expect(pose.x).toBeCloseTo((previous.x + car.x) / 2, 10);
    expect(pose.z).toBeCloseTo((previous.z + car.z) / 2, 10);
  });

  it("throttle increases speed", () => {
    const car = spawned();
    car.advance(PHYSICS_STEP, FULL_THROTTLE);
    expect(car.speed).toBeGreaterThan(0);
  });

  it("advance(0) makes no change", () => {
    const car = spawned();
    car.advance(0, FULL_THROTTLE);
    expectSameState(car, spawned(), 12);
  });

  it("ignores invalid frame deltas without poisoning later simulation", () => {
    const car = spawned();
    for (const elapsed of [NaN, Infinity, -1]) car.advance(elapsed, FULL_THROTTLE);
    car.advance(PHYSICS_STEP, FULL_THROTTLE);
    const expected = spawned();
    expected.advance(PHYSICS_STEP, FULL_THROTTLE);
    expectSameState(car, expected, 12);
  });

  it("resets surface state and accumulated time when respawning", () => {
    const car = spawned();
    car.onTrack = false;
    car.advance(0.4, FULL_THROTTLE);
    car.spawnAtSample(TRACK_DIVISIONS - 14, 0);
    car.advance(0, FULL_THROTTLE);
    expect(car.onTrack).toBe(true);
    expect(car.speed).toBe(0);
  });

  it("is frame-rate independent on track: 30fps vs 144fps", () => {
    const car30 = driveAt(30, 3, FULL_THROTTLE);
    const car144 = driveAt(144, 3, FULL_THROTTLE);
    expect(car30.speed).toBeCloseTo(car144.speed, 4);
    // FP accumulation can leave a one-step residual (~0.1 m); variable-dt
    // integration produced ~4 m of divergence.
    expect(Math.abs(car30.x - car144.x)).toBeLessThan(0.5);
    expect(Math.abs(car30.z - car144.z)).toBeLessThan(0.5);
  });

  it("is frame-rate independent on grass: 30fps vs 144fps", () => {
    const car30 = driveAt(30, 5, STEER_GRASS);
    const car144 = driveAt(144, 5, STEER_GRASS);
    expect(car30.speed).toBeCloseTo(car144.speed, 4);
  });

  it("accumulates sub-step elapsed time across advance() calls", () => {
    const whole = spawned();
    whole.advance(PHYSICS_STEP, FULL_THROTTLE);
    const halves = spawned();
    halves.advance(PHYSICS_STEP / 2, FULL_THROTTLE);
    halves.advance(PHYSICS_STEP / 2, FULL_THROTTLE);
    expectSameState(whole, halves, 10);
  });

  it("runs at most MAX_STEPS_PER_FRAME steps per call and carries the rest", () => {
    // 0.4 s demands 48 fixed steps; one call runs 8 and keeps the remainder.
    const car = spawned();
    car.advance(0.4, FULL_THROTTLE);
    const after8 = spawned();
    runSteps(after8, MAX_STEPS_PER_FRAME, FULL_THROTTLE);
    expectSameState(car, after8, 9);

    // An idle frame drains 8 more rather than finding an empty accumulator.
    car.advance(0, FULL_THROTTLE);
    const after16 = spawned();
    runSteps(after16, 2 * MAX_STEPS_PER_FRAME, FULL_THROTTLE);
    expectSameState(car, after16, 9);
  });

  it("recovers a stall with no lost time up to the backlog cap", () => {
    // A 0.4 s stall (< MAX_ACCUMULATED_TIME) followed by steady 60 fps frames
    // must match feeding the same wall-clock time entirely at 60 fps.
    const dt60 = 1 / 60;
    const followFrames = 120;
    const stalled = spawned();
    stalled.advance(0.4, FULL_THROTTLE);
    for (let i = 0; i < followFrames; i++) stalled.advance(dt60, FULL_THROTTLE);
    const smooth = spawned();
    const smoothFrames = Math.round((0.4 + followFrames * dt60) / dt60);
    for (let i = 0; i < smoothFrames; i++) smooth.advance(dt60, FULL_THROTTLE);
    // Within a one-step FP residual; dropping the owed ~40 steps would leave
    // the stalled car tens of m/s slower and many metres behind.
    expect(Math.abs(stalled.speed - smooth.speed)).toBeLessThan(1.5);
    expect(Math.abs(stalled.x - smooth.x)).toBeLessThan(1);
    expect(Math.abs(stalled.z - smooth.z)).toBeLessThan(1);
  });

  it("drops backlog beyond MAX_ACCUMULATED_TIME", () => {
    const huge = spawned();
    huge.advance(10, FULL_THROTTLE);
    for (let i = 0; i < 20; i++) huge.advance(0, FULL_THROTTLE);
    const capped = spawned();
    capped.advance(MAX_ACCUMULATED_TIME, FULL_THROTTLE);
    for (let i = 0; i < 20; i++) capped.advance(0, FULL_THROTTLE);
    expectSameState(huge, capped, 6);

    const uncapped = spawned();
    runSteps(uncapped, Math.round(10 / PHYSICS_STEP), FULL_THROTTLE);
    expect(Math.abs(uncapped.x - huge.x)).toBeGreaterThan(1);
  });
});
