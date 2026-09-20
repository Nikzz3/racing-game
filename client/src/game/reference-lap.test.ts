import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildReferenceLap, type ReferenceLap } from "./reference-lap";
import { runPolicyLap, type PolicyWeights, type RunResult } from "./harness";

const POLICY_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../rl/policy.json");
const DT_MS = 1000 / 60;

describe.skipIf(!existsSync(POLICY_PATH))("buildReferenceLap", () => {
  let lap: ReferenceLap;
  let result: RunResult;
  beforeAll(() => {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf-8")) as PolicyWeights;
    lap = buildReferenceLap(policy)!;
    result = runPolicyLap(policy)!;
    expect(lap).not.toBeNull();
    expect(result).not.toBeNull();
  }, 120_000);

  it("is the AI Record driving police, timed like the harness lap", () => {
    expect(lap.name).toBe("AI Record");
    expect(lap.variant).toBe("police");
    expect(lap.timeMs).toBe(result.lapTimeMs);
  });

  it("has one well-formed frame per lap step at 1000/60 ms spacing from 0", () => {
    expect(lap.frames.length).toBe(Math.round(lap.timeMs / DT_MS) + 1);
    expect(lap.frames[0][0]).toBe(0);
    expect(lap.frames[lap.frames.length - 1][0]).toBeCloseTo(lap.timeMs, 5);
    for (let i = 0; i < lap.frames.length; i++) {
      const frame = lap.frames[i];
      expect(frame).toHaveLength(5);
      for (const v of frame) expect(Number.isFinite(v)).toBe(true);
      if (i > 0) expect(frame[0] - lap.frames[i - 1][0]).toBeCloseTo(DT_MS, 5);
    }
  });

  it("rounds the timed-lap trajectory: x/z/speed to 2dp, heading to 3dp", () => {
    const lapSteps = Math.round(result.lapTimeMs / DT_MS);
    const lapTraj = result.trajectory.slice(result.steps - 1 - lapSteps);
    expect(lap.frames.length).toBe(lapTraj.length);
    lap.frames.forEach((frame, i) => {
      const step = lapTraj[i];
      expect(frame[1]).toBe(Math.round(step.x * 100) / 100);
      expect(frame[2]).toBe(Math.round(step.z * 100) / 100);
      expect(frame[3]).toBe(Math.round(step.heading * 1000) / 1000);
      expect(frame[4]).toBe(Math.round(step.speed * 100) / 100);
    });
  });
});
