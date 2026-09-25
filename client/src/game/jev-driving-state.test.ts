import { describe, expect, it } from "vitest";
import { jevDrivingState, SUNSET_RIDGE, TRACK_DIVISIONS } from "@racing/shared";
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
