import { describe, it, expect } from "vitest";
import { MAX_SPEED_MS, ROAD_HALF_WIDTH, SUNSET_RIDGE, TRACK_DIVISIONS } from "@racing/shared";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, type CarObstacle } from "./car-collision";
import { CarPhysics, PHYSICS_STEP, MAX_STEPS_PER_FRAME, MAX_ACCUMULATED_TIME } from "./physics";
import type { CarInput } from "./input";

const FULL_THROTTLE: CarInput = { throttle: 1, brake: 0, steer: 0 };
const STEER_GRASS: CarInput = { throttle: 1, brake: 0, steer: 1 };
const COAST: CarInput = { throttle: 0, brake: 0, steer: 0 };

function spawned(): CarPhysics {
  const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
  car.spawnAtSample(TRACK_DIVISIONS - 14, 0);
  return car;
}

/** Each PHYSICS_STEP advance drains exactly one step. */
function runSteps(
  car: CarPhysics,
  n: number,
  input: CarInput,
  obstacles: CarObstacle[] = [],
): void {
  for (let i = 0; i < n; i++) car.advance(PHYSICS_STEP, input, obstacles);
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

  it("reports how far its physical state trails the frames fed to it", () => {
    const car = spawned();
    expect(car.backlog).toBe(0);
    car.advance(PHYSICS_STEP * 2.5, FULL_THROTTLE);
    expect(car.backlog).toBeCloseTo(PHYSICS_STEP * 0.5, 12);
    // A long frame leaves whatever the per-frame step cap could not simulate.
    car.advance(PHYSICS_STEP * (MAX_STEPS_PER_FRAME + 2), FULL_THROTTLE);
    expect(car.backlog).toBeCloseTo(PHYSICS_STEP * 2.5, 12);
  });
});

/** A car parked `ahead` metres along the spawned car's heading and `right` metres to its side. */
function parked(car: CarPhysics, ahead: number, right = 0, speed = 0): CarObstacle {
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  return {
    x: car.x + forwardX * ahead + forwardZ * right,
    z: car.z + forwardZ * ahead - forwardX * right,
    heading: car.heading,
    speed,
    side: 1,
  };
}

function along(car: CarPhysics, other: CarObstacle): number {
  return (other.x - car.x) * Math.sin(car.heading) + (other.z - car.z) * Math.cos(car.heading);
}

describe("CarPhysics.advance — other players' cars", () => {
  it("stops at a parked car instead of driving through it", () => {
    const car = spawned();
    const other = parked(car, 12);
    for (let frame = 0; frame < 120; frame++) {
      car.advance(1 / 60, FULL_THROTTLE, [other]);
      expect(along(car, other)).toBeGreaterThanOrEqual(CAR_HALF_LENGTH * 2 - 1e-9);
    }
    const ghost = spawned();
    for (let frame = 0; frame < 120; frame++) ghost.advance(1 / 60, FULL_THROTTLE);
    expect(along(ghost, other)).toBeLessThan(0);
  });

  it("gives a rear-ended car its half of the closing speed", () => {
    const car = spawned();
    const rammer = parked(car, -(CAR_HALF_LENGTH * 2 - 0.1), 0, 20);
    runSteps(car, 1, COAST, [rammer]);
    // Equal masses with restitution 0.3: (1 + 0.3) / 2 of the 20 m/s closing speed.
    expect(car.speed).toBeCloseTo(13, 6);
  });

  it("keeps its speed when side-swiped by a car at the same speed, but is pushed clear", () => {
    const car = spawned();
    car.speed = 30;
    const control = spawned();
    control.speed = 30;
    const alongside = parked(car, 0, CAR_HALF_WIDTH * 2 - 0.3, 30);
    runSteps(car, 1, COAST, [alongside]);
    runSteps(control, 1, COAST);
    expect(car.speed).toBeCloseTo(control.speed, 9);
    expect(Math.hypot(car.x - control.x, car.z - control.z)).toBeCloseTo(0.3, 6);
  });

  it("never trusts another car's reported speed past the Room's top speed", () => {
    const car = spawned();
    const rammer = parked(car, -(CAR_HALF_LENGTH * 2 - 0.1), 0, 400);
    runSteps(car, 1, COAST, [rammer]);
    expect(car.speed).toBeCloseTo(((1 + 0.3) / 2) * MAX_SPEED_MS.medium, 6);
  });

  it("never bounces a car back faster than it can reverse", () => {
    const car = spawned();
    car.speed = MAX_SPEED_MS.medium;
    const oncoming = { ...parked(car, CAR_HALF_LENGTH * 2 - 0.1, 0, MAX_SPEED_MS.medium) };
    oncoming.heading += Math.PI;
    runSteps(car, 1, COAST, [oncoming]);
    expect(car.speed).toBe(-14);
  });
});

describe("CarPhysics.predict", () => {
  /** Two cars driven identically: one predicts, the other really steps. */
  function twins(input: CarInput, seconds: number): [CarPhysics, CarPhysics] {
    const pair: [CarPhysics, CarPhysics] = [spawned(), spawned()];
    for (const car of pair)
      for (let i = 0; i < Math.round(seconds * 60); i++) car.advance(1 / 60, input);
    return pair;
  }

  it("returns the current pose for zero seconds", () => {
    const [car] = twins(FULL_THROTTLE, 1);
    expect(car.predict(0, STEER_GRASS)).toEqual({
      x: car.x,
      z: car.z,
      heading: car.heading,
      speed: car.speed,
    });
  });

  it("matches really stepping the car the same number of fixed steps", () => {
    const [car, twin] = twins(FULL_THROTTLE, 1.5);
    const predicted = car.predict(30 * PHYSICS_STEP, STEER_GRASS);
    for (let i = 0; i < 30; i++) twin.update(PHYSICS_STEP, STEER_GRASS);
    expect(predicted).toEqual({ x: twin.x, z: twin.z, heading: twin.heading, speed: twin.speed });
  });

  it("carries barrier contact into the prediction", () => {
    // Pinned to the barrier: a copy that forgot the contact would lose speed to a fresh hit.
    const [car, twin] = [spawned(), spawned()];
    for (const c of [car, twin]) {
      c.spawnAtSample(TRACK_DIVISIONS - 14, ROAD_HALF_WIDTH + 1);
      c.heading += Math.PI / 2;
      runSteps(c, 240, FULL_THROTTLE);
    }
    const predicted = car.predict(10 * PHYSICS_STEP, FULL_THROTTLE);
    for (let i = 0; i < 10; i++) twin.update(PHYSICS_STEP, FULL_THROTTLE);
    expect(predicted.speed).toBeGreaterThan(5);
    expect(predicted.speed).toBe(twin.speed);
  });

  it("leaves the real car, its backlog and its render pose untouched", () => {
    const [car, twin] = twins(FULL_THROTTLE, 1);
    car.advance(PHYSICS_STEP / 2, FULL_THROTTLE);
    twin.advance(PHYSICS_STEP / 2, FULL_THROTTLE);
    const before = { ...car.getRenderPose() };
    car.predict(0.5, STEER_GRASS);
    expect(car.getRenderPose()).toEqual(before);
    expect(car.backlog).toBe(twin.backlog);
    for (const c of [car, twin]) c.advance(0.2, STEER_GRASS);
    expect([car.x, car.z, car.heading, car.speed, car.onTrack, car.centerIndex]).toEqual([
      twin.x,
      twin.z,
      twin.heading,
      twin.speed,
      twin.onTrack,
      twin.centerIndex,
    ]);
  });
});
