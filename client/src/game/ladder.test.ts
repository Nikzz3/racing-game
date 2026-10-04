import { describe, expect, it } from "vitest";
import type { Standing } from "@racing/shared";
import { ladderStep, type Board, type Rival } from "./ladder";

// Sunset Ridge at Medium: Bronze 0:35.700, Silver 0:28.560, Gold 0:25.230, Author 0:23.800.
const BOARD: Board = { track: "sunset-ridge", difficulty: "medium" };
const ANA: Rival = { name: "Ana", timeMs: 24_440 };
const BEN: Rival = { name: "Ben", timeMs: 24_100 };

function on(bestMs: number | null, rival: Rival | null = null, board = BOARD): Standing {
  return { ...board, bestMs, rival };
}

describe("ladderStep medal award", () => {
  it("awards the better Medal a lap earned, with that lap", () => {
    const step = ladderStep([on(30_000)], [on(28_000)], BOARD, null);
    expect(step.award).toEqual({ medal: "silver", lapMs: 28_000, unlocked: ["race"] });
  });

  it("awards nothing when the board's Medal did not improve", () => {
    expect(ladderStep([on(28_500)], [on(27_000)], BOARD, null).award).toBeNull();
    expect(ladderStep([on(null)], [on(40_000)], BOARD, null).award).toBeNull();
  });

  it("awards nothing against an unknown baseline", () => {
    expect(ladderStep([], [on(25_000)], BOARD, null).award).toBeNull();
  });

  it("unlocks every Variant whose tier the best Medal anywhere newly reached", () => {
    const step = ladderStep([on(null)], [on(25_000)], BOARD, null);
    expect(step.award?.unlocked).toEqual(["sedan-sports", "race", "police"]);
  });

  it("unlocks nothing that a Medal on another board already had", () => {
    const stormhaven = on(31_000, null, { track: "stormhaven", difficulty: "medium" });
    const step = ladderStep([on(30_000), stormhaven], [on(25_000), stormhaven], BOARD, null);
    expect(step.award).toMatchObject({ medal: "gold", unlocked: [] });
  });
});

describe("ladderStep rival", () => {
  it("offers the new Standing's Rival unless the Pacer already is them", () => {
    expect(ladderStep([on(26_000)], [on(25_000, ANA)], BOARD, null).rival).toEqual({
      kind: "offer",
      rival: ANA,
    });
    expect(ladderStep([on(26_000)], [on(25_000, ANA)], BOARD, "AI Record").rival).toEqual({
      kind: "offer",
      rival: ANA,
    });
    expect(ladderStep([on(26_000, ANA)], [on(25_000, ANA)], BOARD, "Ana").rival).toBeNull();
  });

  it("moves up without asking once the Rival being raced is beaten", () => {
    expect(ladderStep([on(25_000, ANA)], [on(24_300, BEN)], BOARD, "Ana").rival).toEqual({
      kind: "beaten",
      next: BEN,
    });
  });

  it("reports the top of the ladder when no faster Replay is left", () => {
    expect(ladderStep([on(24_200, BEN)], [on(24_000, null)], BOARD, "Ben").rival).toEqual({
      kind: "beaten",
      next: null,
    });
  });

  it("does not count a Pacer the previous Standing never named as a beaten Rival", () => {
    expect(ladderStep([on(25_000, BEN)], [on(24_300, BEN)], BOARD, "Ana").rival).toEqual({
      kind: "offer",
      rival: BEN,
    });
  });

  it("does nothing without a Standing for the Room's board", () => {
    expect(ladderStep([on(25_000, ANA)], [], BOARD, "Ana")).toEqual({ award: null, rival: null });
  });
});
