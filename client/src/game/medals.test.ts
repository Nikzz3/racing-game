import { describe, expect, it } from "vitest";
import {
  DIFFICULTIES,
  medalBeats,
  medalFor,
  medalTimes,
  nextMedal,
  TRACKS,
  variantUnlocked,
} from "@racing/shared";
import policy from "../../../rl/policy.json";
import { runPolicyLap } from "./harness";

const SUNSET_MEDIUM = medalTimes("sunset-ridge", "medium")!;

describe("medalTimes", () => {
  it("anchors Sunset Ridge at Medium on the AI Reference Lap", () => {
    // A retrained policy moves the AI Record; the Author medal must move with it.
    expect(SUNSET_MEDIUM.author).toBe(runPolicyLap(policy)!.lapTimeMs);
  }, 60_000);

  it("derives Gold, Silver and Bronze at 106%, 120% and 150%, rounded up to hundredths", () => {
    expect(SUNSET_MEDIUM).toEqual({ author: 23_800, gold: 25_230, silver: 28_560, bronze: 35_700 });
  });

  it("covers every board", () => {
    for (const track of TRACKS)
      for (const difficulty of DIFFICULTIES)
        expect(medalTimes(track.id, difficulty), `${track.id} ${difficulty}`).not.toBeNull();
  });
});

describe("medalFor and nextMedal", () => {
  it.each([
    [null, null, "bronze"],
    [SUNSET_MEDIUM.bronze + 1, null, "bronze"],
    [SUNSET_MEDIUM.bronze, "bronze", "silver"],
    [SUNSET_MEDIUM.gold, "gold", "author"],
    [SUNSET_MEDIUM.author, "author", null],
    [20_000, "author", null],
  ] as const)("a best of %s earns %s and targets %s", (best, earned, next) => {
    expect(medalFor(SUNSET_MEDIUM, best)).toBe(earned);
    expect(nextMedal(SUNSET_MEDIUM, best)).toBe(next);
  });

  it("ranks any Medal above none", () => {
    expect(medalBeats("bronze", null)).toBe(true);
    expect(medalBeats("author", "gold")).toBe(true);
    expect(medalBeats("gold", "gold")).toBe(false);
    expect(medalBeats(null, "bronze")).toBe(false);
  });
});

describe("variantUnlocked", () => {
  it("frees the starter cars and gates the rest behind the best Medal anywhere", () => {
    expect(variantUnlocked("taxi", null)).toBe(true);
    expect(variantUnlocked("sedan-sports", null)).toBe(false);
    expect(variantUnlocked("sedan-sports", "bronze")).toBe(true);
    expect(variantUnlocked("police", "silver")).toBe(false);
    expect(variantUnlocked("police", "author")).toBe(true);
    expect(variantUnlocked("race-future", "gold")).toBe(false);
  });
});
