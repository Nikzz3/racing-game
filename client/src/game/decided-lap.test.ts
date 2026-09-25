import { describe, it, expect, beforeAll } from "vitest";
import { nearestCenterline, SUNSET_RIDGE } from "@racing/shared";
import {
  autopilotInput,
  lapFrames,
  runDecidedLap,
  type DecidedLap,
  type DecisionContext,
  type StepState,
} from "./harness";
import type { CarInput } from "./input";

const DT_MS = 1000 / 60;
const EVERY = 6;

interface FakeDecision extends CarInput {
  pose: StepState;
  step: number;
}

/** The autopilot, fed only the pose a decider is given, like Jev. */
function autopilotDecider(asked: DecisionContext[]) {
  return (pose: StepState, context: DecisionContext): Promise<FakeDecision> => {
    asked.push(context);
    const { index } = nearestCenterline(pose.x, pose.z, SUNSET_RIDGE.samples);
    const input = autopilotInput({ ...pose, centerIndex: index }, SUNSET_RIDGE.samples);
    return Promise.resolve({ ...input, pose, step: context.step });
  };
}

describe("runDecidedLap", () => {
  const asked: DecisionContext[] = [];
  let lap: DecidedLap<FakeDecision>;
  beforeAll(async () => {
    lap = (await runDecidedLap(autopilotDecider(asked), { decideEverySteps: EVERY }))!;
    expect(lap).not.toBeNull();
  }, 60_000);

  it("completes a lap, asking every N steps and holding each answer until the next", () => {
    expect(lap.lapTimeMs).toBeGreaterThan(20_000);
    expect(asked.map((c) => c.step)).toEqual(
      Array.from({ length: Math.ceil(lap.steps / EVERY) }, (_, i) => i * EVERY),
    );
    // The car needs checkpoint 0 until it first crosses the start line.
    expect(asked[0].nextCheckpoint).toBe(0);
    expect(new Set(asked.map((c) => c.nextCheckpoint)).size).toBe(SUNSET_RIDGE.checkpoints.length);
    lap.inputs.forEach((input, step) => {
      const held = lap.decisions.find((d) => d.decision.step === step - (step % EVERY));
      if (held) expect(input).toBe(held.decision);
    });
  });

  it("times decisions from lap start on the frames' clock, dropping the run-up", () => {
    const frames = lapFrames(lap);
    const first = lap.decisions[0].timeMs;
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(EVERY * DT_MS);
    expect(lap.decisions.at(-1)!.timeMs).toBeLessThan(lap.lapTimeMs);
    expect(lap.decisions.length).toBe(Math.ceil((lap.lapTimeMs - first) / (EVERY * DT_MS)));
    for (const { timeMs, decision } of lap.decisions) {
      // Each decision sits on the frame of the pose it judged.
      const frame = frames[Math.round(timeMs / DT_MS)];
      expect(frame[0]).toBe(timeMs);
      expect(frame[1]).toBeCloseTo(decision.pose.x, 2);
      expect(frame[2]).toBeCloseTo(decision.pose.z, 2);
    }
    for (let i = 1; i < lap.decisions.length; i++)
      expect(lap.decisions[i].timeMs - lap.decisions[i - 1].timeMs).toBeCloseTo(EVERY * DT_MS, 6);
  });

  it("drives the same lap however long the decider takes to answer", async () => {
    const instant = autopilotDecider([]);
    const slow = (pose: StepState, context: DecisionContext) =>
      new Promise<FakeDecision>((resolve) => setTimeout(() => resolve(instant(pose, context)), 0));
    const slowLap = (await runDecidedLap(slow, { decideEverySteps: EVERY }))!;
    expect(slowLap.lapTimeMs).toBe(lap.lapTimeMs);
    expect(slowLap.trajectory).toEqual(lap.trajectory);
  }, 60_000);

  it("is null when no lap completes within maxSteps", async () => {
    const result = await runDecidedLap(autopilotDecider([]), {
      decideEverySteps: EVERY,
      maxSteps: 600,
    });
    expect(result).toBeNull();
  });
});
