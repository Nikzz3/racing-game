import { describe, expect, it } from "vitest";
import {
  BRAKE_DECEL,
  DRAG,
  FULL_GRIP_SPEED,
  GRIP_FADE,
  jevDrivingState,
  speedForTurnRadius,
  steeringGrip,
  SUNSET_RIDGE,
  TRACK_DIVISIONS,
} from "@racing/shared";
import { CarPhysics } from "./physics";

/** A car on the start straight after a third of a second at `steer`, then two thirds straight. */
function driveOff(steer: number): CarPhysics {
  const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
  car.spawnAtSample(TRACK_DIVISIONS - 20, 0);
  for (let i = 0; i < 60; i++)
    car.update(1 / 60, { throttle: 1, brake: 0, steer: i < 20 ? steer : 0 });
  return car;
}

// The state Jev reads names sides from the driver's seat; the physics decides which
// way that is (steer +1 is A / ArrowLeft), so check the words against the physics.
describe("jevDrivingState against CarPhysics", () => {
  it("says the car is left of centre after steering left, and right after steering right", () => {
    expect(jevDrivingState(driveOff(1), SUNSET_RIDGE).car_position).toMatch(/ m left of the road/);
    expect(jevDrivingState(driveOff(-1), SUNSET_RIDGE).car_position).toMatch(
      / m right of the road/,
    );
  });

  it("says the nose points left after steering left", () => {
    expect(jevDrivingState(driveOff(1), SUNSET_RIDGE).nose_direction).toMatch(
      /to the left of the road/,
    );
  });
});

/** A medium car on the long start straight, at `speed`, heading down the road. */
function carAt(speed: number): CarPhysics {
  const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
  car.spawnAtSample(TRACK_DIVISIONS - 20, 0);
  car.speed = speed;
  return car;
}

// Jev's speed check reads the handling constants CarPhysics integrates; check the
// two formulas it builds on against the real car, so neither can drift.
describe("Jev's handling model against CarPhysics", () => {
  it("turns on the radius speedForTurnRadius promises at full lock", () => {
    for (const radius of [30, 60, 100]) {
      const speed = speedForTurnRadius(radius);
      expect(speed).toBeGreaterThanOrEqual(FULL_GRIP_SPEED);
      const car = carAt(speed);
      const heading = car.heading;
      // Pin the speed each step so only the steering is measured.
      const step = 1 / 600;
      for (let i = 0; i < 60; i++) {
        car.update(step, { throttle: 0, brake: 0, steer: 1 });
        car.speed = speed;
      }
      const yawRate = (car.heading - heading) / (60 * step);
      // Coast and drag shave a hair off the speed within each step.
      expect(speed / yawRate / radius).toBeCloseTo(1, 2);
    }
  });

  it("brakes at BRAKE_DECEL plus drag", () => {
    const car = carAt(60);
    const dt = 1 / 1000;
    car.update(dt, { throttle: 0, brake: 1, steer: 0 });
    const expected = 60 - BRAKE_DECEL * dt - (60 - BRAKE_DECEL * dt) ** 2 * DRAG * dt;
    expect(car.speed).toBeCloseTo(expected, 9);
    expect(steeringGrip(60)).toBeCloseTo(1 / (1 + 60 * GRIP_FADE), 12);
  });
});
