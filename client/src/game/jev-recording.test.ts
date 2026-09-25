import { describe, expect, it } from "vitest";
import { decisionAt, type JevRecordedDecision } from "./jev-recording";

const DECISIONS: JevRecordedDecision[] = [
  [0, 0.9, 0.2, 0.8, 0.6],
  [100, 0.1, 0.7, 0.8, 0.4],
  [200, 0.6, 0.5, 0.2, 0],
];

describe("decisionAt", () => {
  it("returns the latest decision made at or before the time, with the count so far", () => {
    expect(decisionAt(DECISIONS, 150)).toEqual({
      decision: { accelerate: 0.1, left: 0.7, pedalConfidence: 0.8, steerConfidence: 0.4 },
      madeAt: 100,
      count: 2,
    });
    expect(decisionAt(DECISIONS, 200)?.count).toBe(3);
    expect(decisionAt(DECISIONS, 9_999)?.madeAt).toBe(200);
  });

  it("is null before the first decision", () => {
    expect(decisionAt(DECISIONS, -1)).toBeNull();
    expect(decisionAt([], 50)).toBeNull();
  });
});
