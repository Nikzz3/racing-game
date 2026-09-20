import { describe, expect, it } from "vitest";
import { SUNSET_RIDGE, MAX_SPEED_MS, minPlausibleLapMs } from "@racing/shared";
import { createTiming, updateTiming, type LapResult } from "../../../server/src/timing";
import lapInputs from "../../../e2e/lap-inputs.json";
import { CarPhysics } from "./physics";
import { E2eSeam } from "./e2e-seam";

describe("browser replay cadence with slow, uneven render frames", () => {
  it("completes a plausible recorded lap without skipping server checkpoints", () => {
    const car = new CarPhysics("medium", SUNSET_RIDGE.samples);
    car.spawnAtSample(SUNSET_RIDGE.samples.length - 14, 0);
    const timing = createTiming();
    let now = 0;
    const completed: LapResult[] = [];
    const checkpoints: number[] = [];
    const seam = new E2eSeam(
      {
        step: (dt, input) => car.update(dt, input),
        localState: () => ({
          position: { x: car.x, z: car.z },
          heading: car.heading,
          speed: car.speed,
          checkpoint: timing.next,
          lap: { laps: timing.laps, active: timing.lapStartT !== null },
        }),
        remotePlayerIds: () => [],
        playerVariants: () => ({}),
        pacerVariant: () => null,
        pacerState: () => null,
        sendState: () => {
          const previousCheckpoint = timing.next;
          const lap = updateTiming(
            timing,
            car.x,
            car.z,
            now,
            SUNSET_RIDGE.checkpoints,
            MAX_SPEED_MS.medium,
            minPlausibleLapMs(SUNSET_RIDGE, MAX_SPEED_MS.medium),
          );
          if (lap) completed.push(lap);
          if (timing.next !== previousCheckpoint) checkpoints.push(timing.next);
        },
      },
      50,
    );
    seam.inject(lapInputs);
    const frameDurations = [0.1, 0.2, 0.15, 0.12, 0.18];
    let frame = 0;
    while (seam.driving && frame < 10_000) {
      const elapsed = frameDurations[frame++ % frameDurations.length];
      now += elapsed * 1000;
      seam.advance(elapsed, 3);
    }
    expect(seam.driving).toBe(false);
    expect(completed).toHaveLength(1);
    expect(completed[0].isPlausible).toBe(true);
    expect(checkpoints).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1]);
  });
});
