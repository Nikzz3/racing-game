import { describe, expect, it, vi } from "vitest";
import {
  JEV_QUESTIONS,
  jevDrivingState,
  jevInput,
  SUNSET_RIDGE,
  TRACK_DIVISIONS,
  type JevPose,
} from "@racing/shared";
import { createJevDriver, createStubJevDriver, createTypeSafeJevDriver } from "./jev";

/** A pose on the centre line at `index`, pointing down the road, turned by `turn` rad. */
function poseAt(index: number, { turn = 0, lateral = 0, speed = 40 } = {}): JevPose {
  const s = SUNSET_RIDGE.samples[index];
  // (-dirZ, dirX) points left of the direction of travel.
  return {
    x: s.x - s.dirZ * lateral,
    z: s.z + s.dirX * lateral,
    heading: Math.atan2(s.dirX, s.dirZ) + turn,
    speed,
  };
}

// The start straight, ahead of the fixed spawn (TRACK_DIVISIONS - 14).
const STRAIGHT = TRACK_DIVISIONS - 20;

describe("jevDrivingState", () => {
  it("describes a car on the centre line pointing down a straight road", () => {
    const state = jevDrivingState(poseAt(STRAIGHT, { speed: 50 }), SUNSET_RIDGE);
    expect(state.speed_kmh).toBe(180);
    expect(state.on_tarmac).toBe(true);
    expect(state.car_position).toMatch(/^0\.0 m (left|right) of the road centre line/);
    expect(state.nose_direction).toMatch(/^[0-2]° to the/);
    expect(state.road_ahead).toHaveLength(4);
    expect(state.road_ahead[0]).toMatch(/^15 m ahead the road centre is [0-3]° to the/);
  });

  it("names the side from the car's point of view (steer +1 is left)", () => {
    // Nose turned right of the road: the road centre ahead is to the car's left.
    const turnedRight = jevDrivingState(poseAt(STRAIGHT, { turn: -0.3 }), SUNSET_RIDGE);
    expect(turnedRight.nose_direction).toMatch(/^1[5-9]° to the right of the road direction/);
    expect(turnedRight.road_ahead[1]).toMatch(/to the left of where the car is pointing$/);

    const turnedLeft = jevDrivingState(poseAt(STRAIGHT, { turn: 0.3 }), SUNSET_RIDGE);
    expect(turnedLeft.nose_direction).toMatch(/to the left of the road direction$/);
    expect(turnedLeft.road_ahead[1]).toMatch(/to the right of where the car is pointing$/);
  });

  it("reports the lateral offset and leaving the tarmac", () => {
    const left = jevDrivingState(poseAt(STRAIGHT, { lateral: 3 }), SUNSET_RIDGE);
    expect(left.car_position).toMatch(/^3\.0 m left of the road centre line/);
    expect(left.on_tarmac).toBe(true);
    const offRight = jevDrivingState(poseAt(STRAIGHT, { lateral: -10 }), SUNSET_RIDGE);
    expect(offRight.car_position).toMatch(/^10\.0 m right of/);
    expect(offRight.on_tarmac).toBe(false);
  });

  it("finds the fast right sweeper at the end of the start straight", () => {
    const state = jevDrivingState(poseAt(20), SUNSET_RIDGE);
    expect(state.bend_ahead).toMatch(
      /^the sharpest bend in the next 190 m turns \d+° to the right within 40 m, starting \d+ m ahead$/,
    );
  });
});

const SURE = { pedalConfidence: 1, steerConfidence: 1 };

describe("jevInput", () => {
  it("floors the pedal Jev picked and steers by how sure Jev is", () => {
    expect(jevInput({ ...SURE, accelerate: 0.7, left: 0.9 })).toEqual({
      throttle: 1,
      brake: 0,
      steer: expect.closeTo(0.8, 10),
    });
    expect(jevInput({ ...SURE, accelerate: 0.3, left: 0.2 })).toEqual({
      throttle: 0,
      brake: 1,
      steer: expect.closeTo(-0.6, 10),
    });
    expect(jevInput({ ...SURE, accelerate: 0.5, left: 0.5 }).steer).toBe(0);
  });
});

describe("createTypeSafeJevDriver", () => {
  it("asks both questions about the described pose in one request", async () => {
    const systemOne = vi.fn().mockResolvedValue({
      model: "jev-1.13.0",
      answers: {
        pedal: {
          type: "choice",
          choice: "brake",
          confidence: 0.6,
          probabilities: { brake: 0.8, accelerate: 0.2 },
        },
        steer: {
          type: "choice",
          choice: "left",
          confidence: 0.9,
          probabilities: { left: 0.95, right: 0.05 },
        },
      },
      usage: { input_tokens: 900, output_tokens: 40 },
    });
    const driver = createTypeSafeJevDriver({ systemOne });
    const pose = poseAt(STRAIGHT);
    const answer = await driver.decide(pose, SUNSET_RIDGE, { timeoutMs: 1500, maxRetries: 0 });

    expect(answer).toMatchObject({
      accelerate: 0.2,
      left: 0.95,
      pedalConfidence: 0.6,
      steerConfidence: 0.9,
      model: "jev-1.13.0",
    });
    expect(answer.latencyMs).toBeGreaterThanOrEqual(0);
    const [request, options] = systemOne.mock.calls[0];
    expect(request).toEqual({
      state: jevDrivingState(pose, SUNSET_RIDGE),
      questions: JEV_QUESTIONS,
    });
    expect(options).toMatchObject({ timeout: 1500, retry: { maxRetries: 0 } });
  });
});

describe("createJevDriver", () => {
  it("is unavailable without a key or the stub", () => {
    expect(createJevDriver({})).toBeNull();
    expect(createJevDriver({ TYPESAFE_API_KEY: "  " })).toBeNull();
  });

  it("uses TypeSafe with a key, and the stub when JEV_STUB=1", () => {
    expect(createJevDriver({ TYPESAFE_API_KEY: "ts-key" })?.kind).toBe("typesafe");
    expect(createJevDriver({ JEV_STUB: "1", TYPESAFE_API_KEY: "ts-key" })?.kind).toBe("stub");
  });
});

describe("createStubJevDriver", () => {
  it("steers back toward the road and cruises", async () => {
    const stub = createStubJevDriver();
    const turnedRight = await stub.decide(poseAt(STRAIGHT, { turn: -0.3, speed: 5 }), SUNSET_RIDGE);
    expect(turnedRight.left).toBeGreaterThan(0.5);
    expect(turnedRight.accelerate).toBeGreaterThan(0.5);
    const fast = await stub.decide(poseAt(STRAIGHT, { turn: 0.3, speed: 60 }), SUNSET_RIDGE);
    expect(fast.left).toBeLessThan(0.5);
    expect(fast.accelerate).toBeLessThan(0.5);
  });
});
