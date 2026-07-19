import { describe, it, expect } from "vitest";
import { createTiming, respawnTiming, updateTiming } from "./timing";
import { CHECKPOINT_RADIUS, MAX_SPEED_MS, SUNSET_RIDGE, trackLength } from "@racing/shared";

const CHECKPOINTS = SUNSET_RIDGE.checkpoints;
const MAX_SPEED = MAX_SPEED_MS["medium"]; // 90 m/s
const TRACK_LEN = trackLength(SUNSET_RIDGE);
// Per ADR-0005: floor = 0.85 × track length / max speed
const MIN_LAP_MS = Math.floor((0.85 * TRACK_LEN) / MAX_SPEED * 1000);

function atCP(k: number) {
  return { x: CHECKPOINTS[k].x, z: CHECKPOINTS[k].z };
}

/** Drive all checkpoints sequentially with `stepMs` between each, completing one lap. */
function driveLap(stepMs: number, maxSpeedOverride = MAX_SPEED, minLapOverride = MIN_LAP_MS) {
  const t = createTiming();
  const { x: x0, z: z0 } = atCP(0);
  let now = 0;
  // First CP0 crossing: starts the timer.
  updateTiming(t, x0, z0, now, CHECKPOINTS, maxSpeedOverride, minLapOverride);
  for (let k = 1; k < CHECKPOINTS.length; k++) {
    now += stepMs;
    const { x, z } = atCP(k);
    updateTiming(t, x, z, now, CHECKPOINTS, maxSpeedOverride, minLapOverride);
  }
  now += stepMs;
  // Second CP0 crossing: completes the lap.
  return updateTiming(t, x0, z0, now, CHECKPOINTS, maxSpeedOverride, minLapOverride);
}

describe("updateTiming — plausibility: speed bound", () => {
  it("marks a slow realistic lap as plausible", () => {
    // 5 s per checkpoint → well within any speed limit
    const result = driveLap(5000);
    expect(result).not.toBeNull();
    expect(result!.isPlausible).toBe(true);
  });

  it("marks a teleporting lap as implausible", () => {
    // 1 ms per checkpoint: positions jump hundreds of units in 1 ms → speed >> maxSpeed × 1.1
    const result = driveLap(1);
    expect(result).not.toBeNull();
    expect(result!.isPlausible).toBe(false);
  });
});

describe("updateTiming — plausibility: lap-time floor", () => {
  it("marks a lap below the floor as implausible", () => {
    // Use a very high speed tolerance so the window check won't fire,
    // but a minLapMs that the fast lap cannot beat.
    const HUGE_SPEED = 1_000_000;
    const HIGH_FLOOR = 99_999_999; // 100,000 seconds
    const result = driveLap(500, HUGE_SPEED, HIGH_FLOOR);
    expect(result).not.toBeNull();
    expect(result!.isPlausible).toBe(false);
  });

  it("marks a lap above the floor as plausible (floor does not block honest laps)", () => {
    // A slow lap will always exceed a realistic floor.
    const result = driveLap(5000); // ~60 s total, well above any reasonable MIN_LAP_MS
    expect(result).not.toBeNull();
    expect(result!.isPlausible).toBe(true);
  });
});

describe("updateTiming — plausibility state reset", () => {
  it("does not carry implausibility from a previous lap into the next", () => {
    // Lap 1: teleport → implausible.  Lap 2: slow → plausible.
    const t = createTiming();
    const { x: x0, z: z0 } = atCP(0);
    let now = 0;
    // Start the first lap.
    updateTiming(t, x0, z0, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    // Teleport through checkpoints 1…N in 1 ms each.
    for (let k = 1; k < CHECKPOINTS.length; k++) {
      now += 1;
      const { x, z } = atCP(k);
      updateTiming(t, x, z, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    }
    now += 1;
    const lap1 = updateTiming(t, x0, z0, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(lap1).not.toBeNull();
    expect(lap1!.isPlausible).toBe(false); // first lap cheated

    // Lap 2: realistic pace — 5 s per checkpoint.
    for (let k = 1; k < CHECKPOINTS.length; k++) {
      now += 5000;
      const { x, z } = atCP(k);
      updateTiming(t, x, z, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    }
    now += 5000;
    const lap2 = updateTiming(t, x0, z0, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(lap2).not.toBeNull();
    expect(lap2!.isPlausible).toBe(true); // second lap clean
  });

  it("resets implausibility on respawn so the next lap starts clean", () => {
    const t = createTiming();
    const { x: x0, z: z0 } = atCP(0);
    let now = 0;
    // Start a lap and teleport (marks implausible).
    updateTiming(t, x0, z0, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    for (let k = 1; k < CHECKPOINTS.length; k++) {
      now += 1;
      const { x, z } = atCP(k);
      updateTiming(t, x, z, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    }
    expect(t.lapImplausible).toBe(true);

    // Respawn: must clear the flag and window.
    respawnTiming(t);
    expect(t.lapImplausible).toBe(false);
    expect(t.windowSamples).toHaveLength(0);
    expect(t.lapStartT).toBeNull();

    // Drive a clean lap after respawn.
    updateTiming(t, x0, z0, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    for (let k = 1; k < CHECKPOINTS.length; k++) {
      now += 5000;
      const { x, z } = atCP(k);
      updateTiming(t, x, z, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    }
    now += 5000;
    const lap = updateTiming(t, x0, z0, now, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(lap).not.toBeNull();
    expect(lap!.isPlausible).toBe(true);
  });
});

describe("updateTiming — LapResult fields", () => {
  it("returns correct lapTimeMs on a slow lap", () => {
    const STEP = 5000;
    const result = driveLap(STEP);
    expect(result).not.toBeNull();
    // CHECKPOINTS.length steps at STEP ms each.
    expect(result!.lapTimeMs).toBeCloseTo(CHECKPOINTS.length * STEP, -1);
  });

  it("first crossing of CP0 does not count as a lap (no lapStartT yet)", () => {
    const t = createTiming();
    const { x, z } = atCP(0);
    const result = updateTiming(t, x, z, 0, CHECKPOINTS, MAX_SPEED, MIN_LAP_MS);
    expect(result).toBeNull();
  });
});
