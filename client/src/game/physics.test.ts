import { describe, it, expect } from "vitest";
import { DEFAULT_DIFFICULTY, SUNSET_RIDGE, TRACK_DIVISIONS } from "@racing/shared";
import { CarPhysics, PHYSICS_STEP, MAX_STEPS_PER_FRAME, MAX_ACCUMULATED_TIME } from "./physics";
import type { CarInput } from "./input";

const FULL_THROTTLE: CarInput = { throttle: 1, brake: 0, steer: 0 };
const STEER_GRASS: CarInput = { throttle: 1, brake: 0, steer: 1 };

function spawned(): CarPhysics {
  const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
  car.spawnAtSample(TRACK_DIVISIONS - 14, 0);
  return car;
}

/** Run exactly `n` fixed steps: each PHYSICS_STEP advance drains one step. */
function runSteps(car: CarPhysics, n: number, input: CarInput): void {
  for (let i = 0; i < n; i++) car.advance(PHYSICS_STEP, input);
}

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

  it("substep cap engages and carries the owed steps instead of dropping them", () => {
    // 0.4 s demands 48 fixed steps, but one advance() call runs at most
    // MAX_STEPS_PER_FRAME (8). The rest must stay in the accumulator.
    const car = spawned();
    car.advance(0.4, FULL_THROTTLE);

    const after8 = spawned();
    runSteps(after8, MAX_STEPS_PER_FRAME, FULL_THROTTLE);
    // Exactly 8 steps ran on the big frame — the per-call cap engaged.
    expect(car.x).toBeCloseTo(after8.x, 9);
    expect(car.speed).toBeCloseTo(after8.speed, 9);

    // The ~40 owed steps were carried, not dropped: an idle frame drains 8 more.
    // (The old drop-the-remainder behaviour would leave < 1 step, so this
    //  advance(0) would be a no-op and the car would still match after8.)
    car.advance(0, FULL_THROTTLE);
    const after16 = spawned();
    runSteps(after16, 2 * MAX_STEPS_PER_FRAME, FULL_THROTTLE);
    expect(car.x).toBeCloseTo(after16.x, 9);
    expect(car.speed).toBeCloseTo(after16.speed, 9);
  });

  it("recovers a stall with no lost time up to the backlog cap (deterministic)", () => {
    // A 0.4 s stall (< MAX_ACCUMULATED_TIME, so nothing is dropped) followed by
    // steady 60 fps frames must end in the same state as feeding the identical
    // total wall-clock time entirely in 60 fps frames — total simulated time is
    // preserved and the outcome is independent of how time was chopped.
    const dt60 = 1 / 60;
    const followFrames = 120; // 2 s of catch-up room — drains the backlog fully

    const stalled = spawned();
    stalled.advance(0.4, FULL_THROTTLE);
    for (let i = 0; i < followFrames; i++) stalled.advance(dt60, FULL_THROTTLE);

    const smooth = spawned();
    const smoothFrames = Math.round((0.4 + followFrames * dt60) / dt60);
    for (let i = 0; i < smoothFrames; i++) smooth.advance(dt60, FULL_THROTTLE);

    // Both simulate the same total time to within a one-step FP residual
    // (~0.5 m/s of speed, ~0.4 m of distance from the accumulator crossing
    // differently). A lost-time regression — dropping the ~40 steps the stall
    // could not run in one capped frame — would instead leave the stalled car
    // tens of m/s slower and many metres behind, far outside these bounds.
    expect(Math.abs(stalled.speed - smooth.speed)).toBeLessThan(1.5);
    expect(Math.abs(stalled.x - smooth.x)).toBeLessThan(1);
    expect(Math.abs(stalled.z - smooth.z)).toBeLessThan(1);
  });

  it("caps the backlog: time beyond MAX_ACCUMULATED_TIME is dropped", () => {
    // A 10 s stall must not schedule 10 s of catch-up. The accumulator saturates
    // at MAX_ACCUMULATED_TIME, so feeding 10 s is indistinguishable from feeding
    // exactly the cap.
    const huge = spawned();
    huge.advance(10, FULL_THROTTLE);
    for (let i = 0; i < 20; i++) huge.advance(0, FULL_THROTTLE); // drain the capped backlog

    const capped = spawned();
    capped.advance(MAX_ACCUMULATED_TIME, FULL_THROTTLE);
    for (let i = 0; i < 20; i++) capped.advance(0, FULL_THROTTLE);

    expect(huge.x).toBeCloseTo(capped.x, 6);
    expect(huge.z).toBeCloseTo(capped.z, 6);
    expect(huge.speed).toBeCloseTo(capped.speed, 6);

    // And the dropped time really is gone: simulating the full 10 s would travel
    // vastly farther than the ~0.5 s the cap allows.
    const uncapped = spawned();
    runSteps(uncapped, Math.round(10 / PHYSICS_STEP), FULL_THROTTLE);
    expect(Math.abs(uncapped.x - huge.x)).toBeGreaterThan(1);
  });
});
