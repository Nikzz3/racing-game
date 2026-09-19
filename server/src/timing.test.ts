import { describe, it, expect } from "vitest";
import { createTiming, respawnTiming, updateTiming, type TimingState } from "./timing";
import { MAX_SPEED_MS, minPlausibleLapMs, SUNSET_RIDGE } from "@racing/shared";

const CHECKPOINTS = SUNSET_RIDGE.checkpoints;
const MAX_SPEED = MAX_SPEED_MS.medium;
const MIN_LAP_MS = minPlausibleLapMs(SUNSET_RIDGE, MAX_SPEED);
const START = CHECKPOINTS[0];

function at(t: TimingState, k: number, now: number, maxSpeed = MAX_SPEED, minLap = MIN_LAP_MS) {
  return updateTiming(t, CHECKPOINTS[k].x, CHECKPOINTS[k].z, now, CHECKPOINTS, maxSpeed, minLap);
}

/** From a timing state already past the start line, visit every remaining gate and finish. */
function finishLap(t: TimingState, now: number, stepMs: number, maxSpeed = MAX_SPEED, minLap = MIN_LAP_MS) {
  for (let k = 1; k < CHECKPOINTS.length; k++) {
    now += stepMs;
    at(t, k, now, maxSpeed, minLap);
  }
  return { result: at(t, 0, now + stepMs, maxSpeed, minLap), now: now + stepMs };
}

/** Drive one full lap from a fresh state with `stepMs` between gates. */
function driveLap(stepMs: number, maxSpeed = MAX_SPEED, minLap = MIN_LAP_MS) {
  const t = createTiming();
  at(t, 0, 0, maxSpeed, minLap);
  return finishLap(t, 0, stepMs, maxSpeed, minLap).result;
}

describe("updateTiming — speed bound", () => {
  it("marks a slow realistic lap as plausible", () => {
    expect(driveLap(5000)?.isPlausible).toBe(true);
  });

  it("marks a teleporting lap as implausible", () => {
    // 100 ms per gate: hundreds of metres per hop is far past maxSpeed × 1.1.
    expect(driveLap(100)?.isPlausible).toBe(false);
  });

  it("tolerates two honest updates delivered a millisecond apart right after the start line", () => {
    const t = createTiming();
    at(t, 0, 0);
    // Crossing at 15 m/s; the next 50 ms update (0.75 m on) arrives in the same TCP read.
    updateTiming(t, START.x + 0.75, START.z, 1, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(t.lapImplausible).toBe(false);
    for (let ms = 50; ms <= 1000; ms += 50) {
      updateTiming(t, START.x + 0.75 + (15 * ms) / 1000, START.z, ms, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    }
    expect(t.lapImplausible).toBe(false);
  });

  it("still catches a teleport that arrives inside the grace", () => {
    const t = createTiming();
    at(t, 0, 0);
    // 500 m in one tick is 2000 m/s even against the 250 ms floor.
    updateTiming(t, START.x + 500, START.z, 1, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(t.lapImplausible).toBe(true);
  });

  it("flags a lap that idles past the time floor and then bursts every gate inside the grace", () => {
    const t = createTiming();
    at(t, 0, 0);
    // The long gap makes the first hop slow and trimming collapses the window to one sample.
    let now = MIN_LAP_MS + 5000;
    at(t, 1, now);
    for (let k = 2; k < CHECKPOINTS.length; k++) at(t, k, ++now);
    expect(at(t, 0, ++now)?.isPlausible).toBe(false);
  });

  it("flags a single teleport even when samples are spaced beyond the window", () => {
    const t = createTiming();
    at(t, 0, 0);
    updateTiming(t, START.x + 100_000, START.z, 1500, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(t.lapImplausible).toBe(true);
  });
});

describe("updateTiming — lap-time floor", () => {
  it("marks a lap below the floor as implausible", () => {
    // Speed bound cannot fire; the floor alone rejects the lap.
    expect(driveLap(500, 1_000_000, 99_999_999)?.isPlausible).toBe(false);
  });

  it("does not block honest laps", () => {
    expect(driveLap(5000)?.isPlausible).toBe(true);
  });
});

describe("updateTiming — plausibility state reset", () => {
  it("does not carry implausibility from a previous lap into the next", () => {
    const t = createTiming();
    at(t, 0, 0);
    const first = finishLap(t, 0, 100);
    expect(first.result?.isPlausible).toBe(false);
    expect(finishLap(t, first.now, 5000).result?.isPlausible).toBe(true);
  });

  it("resets implausibility on respawn so the next lap starts clean", () => {
    const t = createTiming();
    at(t, 0, 0);
    let now = 0;
    for (let k = 1; k < CHECKPOINTS.length; k++) at(t, k, (now += 100));
    expect(t.lapImplausible).toBe(true);

    respawnTiming(t);
    expect(t.lapImplausible).toBe(false);
    expect(t.windowSamples).toHaveLength(0);
    expect(t.lapStartT).toBeNull();
    // The counter waits for the spawn position so a snapshot never pairs it with the old one.
    expect(t.spawns).toBe(0);
    expect(t.spawnPending).toBe(true);

    at(t, 0, now);
    expect(finishLap(t, now, 5000).result?.isPlausible).toBe(true);
  });
});

describe("updateTiming — LapResult fields", () => {
  it("returns lapTimeMs for a full lap", () => {
    expect(driveLap(5000)?.lapTimeMs).toBe(CHECKPOINTS.length * 5000);
  });

  it("does not count the first start-line crossing as a lap", () => {
    expect(at(createTiming(), 0, 0)).toBeNull();
  });

  it("never lets an implausible lap set isPersonalBest or bestLapMs", () => {
    const t = createTiming();
    at(t, 0, 0);
    const lap = finishLap(t, 0, 1).result;
    expect(lap?.isPlausible).toBe(false);
    expect(lap?.isPersonalBest).toBe(false);
    expect(t.bestLapMs).toBeNull();
  });
});
