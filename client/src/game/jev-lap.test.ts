import { describe, expect, it } from "vitest";
import { JEV_DECISION_INTERVAL_MS } from "@racing/shared";
import { JEV_LAP, parseJevLap } from "./jev-lap";

describe("the bundled Jev Lap", () => {
  it("is a whole recorded lap, with frames and decisions on one clock", () => {
    expect(JEV_LAP).not.toBeNull();
    const { model, timeMs, frames, decisions } = JEV_LAP!;
    expect(model).toMatch(/^jev-/);
    expect(frames[0][0]).toBe(0);
    expect(frames.at(-1)![0]).toBe(timeMs);
    // One decision per 100 ms of game time, all within the timed lap.
    expect(decisions.length).toBe(Math.ceil(timeMs / JEV_DECISION_INTERVAL_MS));
    const frameTimes = new Set(frames.map(([t]) => t));
    for (const [t, ...answers] of decisions) {
      expect(frameTimes.has(t)).toBe(true);
      for (const p of answers) expect(p >= 0 && p <= 1).toBe(true);
    }
  });
});

describe("parseJevLap", () => {
  const valid = {
    model: "jev-1",
    timeMs: 100,
    frames: [
      [0, 1, 2, 0, 5],
      [100, 2, 3, 0.1, 6],
    ],
    decisions: [[0, 0.9, 0.2, 0.8, 0.6]],
    recordedAt: "2026-09-25T00:00:00.000Z",
  };

  it("keeps the recording the replay needs", () => {
    const { recordedAt: _, ...recording } = valid;
    expect(parseJevLap(valid)).toEqual(recording);
  });

  it.each([
    ["not an object", "jev"],
    ["no model", { ...valid, model: undefined }],
    ["no lap time", { ...valid, timeMs: 0 }],
    ["a single frame", { ...valid, frames: [valid.frames[0]] }],
    ["a short frame", { ...valid, frames: [valid.frames[0], [100, 2, 3]] }],
    ["a non-numeric decision", { ...valid, decisions: [[0, "0.9", 0.2, 0.8, 0.6]] }],
    ["no decisions list", { ...valid, decisions: null }],
  ])("rejects %s", (_, value) => {
    expect(parseJevLap(value)).toBeNull();
  });
});
