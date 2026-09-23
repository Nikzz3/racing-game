import { describe, expect, it } from "vitest";
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, carContact, type CarObstacle } from "./car-collision";

function car(x: number, z: number, heading = 0, speed = 0) {
  return { x, z, heading, speed };
}

function obstacle(x: number, z: number, heading = 0, side: 1 | -1 = 1): CarObstacle {
  return { x, z, heading, speed: 0, side };
}

describe("carContact", () => {
  it("ignores cars that are clear of each other", () => {
    expect(carContact(car(0, 0), obstacle(CAR_HALF_WIDTH * 2 + 0.01, 0))).toBeNull();
    expect(carContact(car(0, 0), obstacle(0, CAR_HALF_LENGTH * 2 + 0.01))).toBeNull();
    expect(carContact(car(0, 0), obstacle(50, 50))).toBeNull();
  });

  it("pushes a car sideways out of one alongside it", () => {
    const contact = carContact(car(1.5, 0), obstacle(0, 0));
    expect(contact?.nx).toBeCloseTo(1);
    expect(contact?.nz).toBeCloseTo(0);
    expect(contact?.depth).toBeCloseTo(CAR_HALF_WIDTH * 2 - 1.5);
  });

  it("pushes a car backwards out of the one it rear-ended", () => {
    const contact = carContact(car(0, -4), obstacle(0, 0));
    expect(contact?.nx).toBeCloseTo(0);
    expect(contact?.nz).toBeCloseTo(-1);
    expect(contact?.depth).toBeCloseTo(CAR_HALF_LENGTH * 2 - 4);
  });

  it("uses the rotated footprint, so a T-bone reaches past the side of a car", () => {
    // A car crossing at right angles is long along x; alongside it would be clear.
    const crossing = obstacle(CAR_HALF_WIDTH + CAR_HALF_LENGTH - 0.2, 0, Math.PI / 2);
    const contact = carContact(car(0, 0), crossing);
    expect(contact?.nx).toBeCloseTo(-1);
    expect(contact?.depth).toBeCloseTo(0.2);
  });

  it("separates cars on top of each other towards the side both clients agree on", () => {
    const mine = carContact(car(0, 0), obstacle(0, 0, 0, 1));
    const theirs = carContact(car(0, 0), obstacle(0, 0, 0, -1));
    expect(mine?.depth).toBeCloseTo(CAR_HALF_WIDTH * 2);
    expect(mine?.nx).toBeCloseTo(-(theirs?.nx ?? 0));
    expect(mine?.nz).toBeCloseTo(-(theirs?.nz ?? 0));
  });

  it("parts exactly overlapping cars even when they face opposite ways", () => {
    // Each client lists its own car's axes first, so each may hold the axis negated.
    for (const [a, b] of [
      [0, Math.PI],
      [Math.PI / 2, -Math.PI / 2],
    ]) {
      const mine = carContact(car(0, 0, a), obstacle(0, 0, b, 1));
      const theirs = carContact(car(0, 0, b), obstacle(0, 0, a, -1));
      expect(Math.hypot(mine!.nx + theirs!.nx, mine!.nz + theirs!.nz)).toBeCloseTo(0);
    }
  });
});
