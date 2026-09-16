import { describe, it, expect } from "vitest";
import {
  CheckpointTracker,
  runAutopilotLap,
  replayInputs,
} from "./harness";
import { NUM_CHECKPOINTS, STORMHAVEN, SUNSET_RIDGE } from "@racing/shared";

const TRACKS = [
  { track: SUNSET_RIDGE, maxSteps: 36_000, maxLapMs: 300_000 },
  { track: STORMHAVEN, maxSteps: 72_000, maxLapMs: 600_000 },
];

describe.each(TRACKS)("CheckpointTracker on $track.id", ({ track }) => {
  const cps = track.checkpoints;
  const at = (tracker: CheckpointTracker, k: number, step: number) =>
    tracker.update(cps[k].x, cps[k].z, step);

  it("records a lap time when all checkpoints are passed in order", () => {
    const tracker = new CheckpointTracker(cps);
    expect(at(tracker, 0, 0)).toBeNull();
    for (let k = 1; k < cps.length; k++)
      expect(at(tracker, k, k * 60)).toBeNull();
    // One second (60 steps) per checkpoint.
    expect(at(tracker, 0, cps.length * 60)).toBeCloseTo(cps.length * 1000, 0);
  });

  it("does not count a lap when a checkpoint is skipped", () => {
    const tracker = new CheckpointTracker(cps);
    at(tracker, 0, 0);
    for (let k = 1; k <= 4; k++) at(tracker, k, k * 60);
    expect(at(tracker, 6, 5 * 60)).toBeNull();
    expect(at(tracker, 0, 12 * 60)).toBeNull();
  });

  it("ignores a position outside the checkpoint radius", () => {
    const tracker = new CheckpointTracker(cps);
    expect(tracker.update(9999, 9999, 0)).toBeNull();
    expect(at(tracker, 0, 1)).toBeNull();
    expect(tracker.next).toBe(1);
  });
});

describe("CheckpointTracker track isolation", () => {
  const sr = SUNSET_RIDGE.checkpoints;
  const sh = STORMHAVEN.checkpoints;

  it("the two tracks have geometrically distinct checkpoints", () => {
    const same = sh.every(
      (cp, i) => Math.abs(cp.x - sr[i].x) < 1 && Math.abs(cp.z - sr[i].z) < 1,
    );
    expect(same).toBe(false);
  });

  it("Sunset Ridge checkpoint positions do not complete a Stormhaven lap", () => {
    const tracker = new CheckpointTracker(sh);
    for (let k = 0; k < NUM_CHECKPOINTS; k++)
      tracker.update(sr[k].x, sr[k].z, k * 60);
    expect(tracker.update(sr[0].x, sr[0].z, NUM_CHECKPOINTS * 60)).toBeNull();
  });

  it("a straight grass-cut across the Stormhaven infield does not complete a lap", () => {
    // From just past CP0 straight to CP20, bypassing CPs 1-19.
    const tracker = new CheckpointTracker(sh);
    tracker.update(sh[0].x, sh[0].z, 0);
    for (let i = 1; i <= 10; i++) {
      const frac = i / 11;
      tracker.update(
        sh[1].x + (sh[20].x - sh[1].x) * frac,
        sh[1].z + (sh[20].z - sh[1].z) * frac,
        i * 60,
      );
    }
    for (let k = 20; k < sh.length; k++)
      tracker.update(sh[k].x, sh[k].z, (11 + k - 20) * 60);
    expect(tracker.update(sh[0].x, sh[0].z, (sh.length + 11) * 60)).toBeNull();
  });
});

describe.each(TRACKS)(
  "autopilot baseline lap on $track.id",
  ({ track, maxSteps, maxLapMs }) => {
    it(
      "completes a valid lap from the fixed spawn",
      () => {
        const result = runAutopilotLap({ track, maxSteps });
        expect(result).not.toBeNull();
        expect(result!.lapTimeMs).toBeGreaterThan(20_000);
        expect(result!.lapTimeMs).toBeLessThan(maxLapMs);
        expect(result!.trajectory.length).toBeGreaterThan(0);
        console.log(
          `Autopilot ${track.id} lap time: ${(result!.lapTimeMs / 1000).toFixed(2)} s`,
        );
      },
      60_000,
    );
  },
);

describe("replayInputs", () => {
  const coast = { throttle: 0, brake: 0, steer: 0 };

  it("emits one state per input step, starting at rest near the spawn", () => {
    const { trajectory } = replayInputs(Array.from({ length: 120 }, () => coast));
    expect(trajectory).toHaveLength(120);
    expect(trajectory[0].x).not.toBeNaN();
    expect(trajectory[0].z).not.toBeNaN();
    expect(trajectory[0].speed).toBeCloseTo(0, 1);
  });

  it("reproduces the autopilot's lap time from its recorded inputs", () => {
    const lap = runAutopilotLap()!;
    expect(lap).not.toBeNull();
    const { trajectory, lapTimeMs } = replayInputs(lap.inputs);
    expect(trajectory).toHaveLength(lap.inputs.length);
    expect(lapTimeMs).toBeCloseTo(lap.lapTimeMs, 0);
  });

  it("returns null lapTimeMs when no lap is completed", () => {
    expect(replayInputs(Array(60).fill(coast)).lapTimeMs).toBeNull();
  });
});
