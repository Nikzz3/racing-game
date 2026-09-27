import { describe, expect, it, vi } from "vitest";
import {
  JEV_QUESTIONS,
  jevDrivingState,
  jevInput,
  jevSafeSpeed,
  MAX_SPEED_MS,
  MIN_SAFE_SPEED,
  racingLine,
  STEER_GAIN,
  SUNSET_RIDGE,
  TRACK_DIVISIONS,
  type JevPose,
  type TrackSample,
} from "@racing/shared";
import { createJevDriver, createStubJevDriver, createTypeSafeJevDriver } from "./jev";

/** A pose on the centre line at `index`, pointing down the road, turned by `turn` rad. */
function poseAt(index: number, { turn = 0, lateral = 0, speed = 40 } = {}): JevPose {
  return poseOn(SUNSET_RIDGE.samples[index], { turn, lateral, speed });
}

/** The same, on Jev's racing line instead of the centre line. */
function poseOnLine(index: number, { turn = 0, lateral = 0, speed = 40 } = {}): JevPose {
  return poseOn(racingLine(SUNSET_RIDGE)[index], { turn, lateral, speed });
}

function poseOn(s: TrackSample, { turn = 0, lateral = 0, speed = 40 }): JevPose {
  // (dirZ, -dirX) points left of the direction of travel (steer +1 carries the car there).
  return {
    x: s.x + s.dirZ * lateral,
    z: s.z - s.dirX * lateral,
    heading: Math.atan2(s.dirX, s.dirZ) + turn,
    speed,
  };
}

// The start straight, ahead of the fixed spawn (TRACK_DIVISIONS - 14).
const STRAIGHT = TRACK_DIVISIONS - 20;
// About 30 m before the tight left hairpin at sample 128.
const HAIRPIN_ENTRY = 118;

describe("jevDrivingState", () => {
  it("describes a car on the racing line pointing down a straight road", () => {
    const state = jevDrivingState(poseOnLine(STRAIGHT, { speed: 50 }), SUNSET_RIDGE);
    expect(state.speed_kmh).toBe(180);
    expect(state.on_tarmac).toBe(true);
    expect(state.car_position).toMatch(/^\d\.\d m (left|right) of the road centre line/);
    expect(state.nose_direction).toMatch(/^[0-2]° to the/);
    expect(state.road_ahead).toHaveLength(4);
    expect(state.road_ahead[0]).toMatch(/^15 m ahead the racing line is [0-3]° to the/);
  });

  it("names the side from the car's point of view (steer +1 is left)", () => {
    // Nose turned right of the road: the racing line ahead is to the car's left.
    const turnedRight = jevDrivingState(poseOnLine(STRAIGHT, { turn: -0.3 }), SUNSET_RIDGE);
    expect(turnedRight.nose_direction).toMatch(/^1[5-9]° to the right of the road direction/);
    expect(turnedRight.road_ahead[1]).toMatch(/to the left of where the car is pointing$/);

    const turnedLeft = jevDrivingState(poseOnLine(STRAIGHT, { turn: 0.3 }), SUNSET_RIDGE);
    expect(turnedLeft.nose_direction).toMatch(/to the left of the road direction$/);
    expect(turnedLeft.road_ahead[1]).toMatch(/to the right of where the car is pointing$/);
  });

  it("puts the racing line on the opposite side to the car's offset from it", () => {
    const left = jevDrivingState(poseOnLine(STRAIGHT, { lateral: 3 }), SUNSET_RIDGE);
    expect(left.road_ahead[0]).toMatch(/to the right of where the car is pointing$/);
    const right = jevDrivingState(poseOnLine(STRAIGHT, { lateral: -3 }), SUNSET_RIDGE);
    expect(right.road_ahead[0]).toMatch(/to the left of where the car is pointing$/);
  });

  it("reports the lateral offset from the centre line and leaving the tarmac", () => {
    const left = jevDrivingState(poseAt(STRAIGHT, { lateral: 3 }), SUNSET_RIDGE);
    expect(left.car_position).toMatch(/^3\.0 m left of the road centre line/);
    expect(left.on_tarmac).toBe(true);
    const offRight = jevDrivingState(poseAt(STRAIGHT, { lateral: -10 }), SUNSET_RIDGE);
    expect(offRight.car_position).toMatch(/^10\.0 m right of/);
    expect(offRight.on_tarmac).toBe(false);
  });

  it("gives room to spare on the straight and says too fast at the hairpin", () => {
    expect(jevDrivingState(poseOnLine(STRAIGHT, { speed: 50 }), SUNSET_RIDGE).speed_check).toMatch(
      /^room to spare: the car could go \d+ km\/h faster here and still make the road ahead$/,
    );
    expect(
      jevDrivingState(poseOnLine(HAIRPIN_ENTRY, { speed: 80 }), SUNSET_RIDGE).speed_check,
    ).toMatch(
      /^too fast: the car is \d+ km\/h faster than it can go here and still make the road ahead$/,
    );
  });

  it("counts the margin in km/h against the safe speed", () => {
    const pose = poseOnLine(HAIRPIN_ENTRY, { speed: 80 });
    const over = Math.round((80 - jevSafeSpeed(pose, SUNSET_RIDGE)) * 3.6);
    expect(over).toBeGreaterThan(0);
    expect(jevDrivingState(pose, SUNSET_RIDGE).speed_check).toContain(`is ${over} km/h faster`);
  });
});

describe("jevSafeSpeed", () => {
  it("lets the car reach top speed on the start straight", () => {
    expect(jevSafeSpeed(poseOnLine(0, { speed: 50 }), SUNSET_RIDGE)).toBe(MAX_SPEED_MS.medium);
  });

  it("slows the car the closer it gets to a tight bend", () => {
    const far = jevSafeSpeed(poseOnLine(HAIRPIN_ENTRY - 20, { speed: 60 }), SUNSET_RIDGE);
    const near = jevSafeSpeed(poseOnLine(HAIRPIN_ENTRY, { speed: 60 }), SUNSET_RIDGE);
    expect(near).toBeLessThan(far);
    expect(near).toBeLessThan(MAX_SPEED_MS.medium * 0.75);
  });

  it("slows the car for the turn it must make now, even with a straight road ahead", () => {
    const aligned = jevSafeSpeed(poseOnLine(STRAIGHT, { speed: 50 }), SUNSET_RIDGE);
    const sideways = jevSafeSpeed(poseOnLine(STRAIGHT, { speed: 50, turn: 0.8 }), SUNSET_RIDGE);
    expect(sideways).toBeLessThan(aligned / 2);
  });

  it("never asks the car to go slower than full steering grip needs", () => {
    // Below MIN_SAFE_SPEED the wheel turns the car less, not more, so asking for it would strand the car.
    for (let index = 0; index < TRACK_DIVISIONS; index += 7)
      for (const turn of [-2.5, -1, 0, 1, 2.5])
        for (const lateral of [-12, 0, 12])
          expect(
            jevSafeSpeed(poseAt(index, { turn, lateral, speed: 20 }), SUNSET_RIDGE),
          ).toBeGreaterThanOrEqual(MIN_SAFE_SPEED);
  });
});

const SURE = { pedalConfidence: 1, steerConfidence: 1 };

describe("jevInput", () => {
  it("floors the pedal Jev picked and steers by STEER_GAIN times its lean", () => {
    expect(STEER_GAIN).toBe(2);
    expect(jevInput({ ...SURE, accelerate: 0.7, left: 0.3, right: 0.05 })).toEqual({
      throttle: 1,
      brake: 0,
      steer: expect.closeTo(0.5, 10),
    });
    expect(jevInput({ ...SURE, accelerate: 0.3, left: 0.1, right: 0.4 })).toEqual({
      throttle: 0,
      brake: 1,
      steer: expect.closeTo(-0.6, 10),
    });
    expect(jevInput({ ...SURE, accelerate: 0.5, left: 0.4, right: 0.4 }).steer).toBe(0);
  });

  it("clamps a confident lean to full lock", () => {
    expect(jevInput({ ...SURE, accelerate: 1, left: 0.9, right: 0.05 }).steer).toBe(1);
    expect(jevInput({ ...SURE, accelerate: 1, left: 0.05, right: 0.7 }).steer).toBe(-1);
  });

  it("leaves the wheel centred for nothing, whatever its weight", () => {
    expect(jevInput({ ...SURE, accelerate: 1, left: 0, right: 0 }).steer).toBe(0);
    // A lean inside a mostly-centred answer still turns a little that way.
    expect(jevInput({ ...SURE, accelerate: 1, left: 0.1, right: 0 }).steer).toBeCloseTo(0.2, 10);
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
          probabilities: { left: 0.9, nothing: 0.08, right: 0.02 },
        },
      },
      usage: { input_tokens: 900, output_tokens: 40 },
    });
    const driver = createTypeSafeJevDriver({ systemOne });
    const pose = poseAt(STRAIGHT);
    const answer = await driver.decide(pose, SUNSET_RIDGE, {
      timeoutMs: 1500,
      maxRetries: 0,
    });

    expect(answer).toMatchObject({
      accelerate: 0.2,
      left: 0.9,
      right: 0.02,
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
    expect(turnedRight.right).toBe(0);
    expect(turnedRight.accelerate).toBeGreaterThan(0.5);
    const fast = await stub.decide(poseAt(STRAIGHT, { turn: 0.3, speed: 60 }), SUNSET_RIDGE);
    expect(fast.right).toBeGreaterThan(0.5);
    expect(fast.left).toBe(0);
    expect(fast.accelerate).toBeLessThan(0.5);
  });

  it("mostly leaves the wheel alone when the car points down the road", async () => {
    const answer = await createStubJevDriver().decide(poseAt(STRAIGHT), SUNSET_RIDGE);
    const nothing = 1 - answer.left - answer.right;
    expect(nothing).toBeGreaterThan(0.5);
    expect(nothing).toBeLessThanOrEqual(1);
    expect(answer.steerConfidence).toBeGreaterThan(0);
  });
});
