import { describe, expect, it } from "vitest";
import { testDatabaseUrl, withTestSchema } from "./test-database";

describe.skipIf(!testDatabaseUrl)("leaderboard boards", () => {
  it("returns each (track, difficulty) board's ten fastest laps, grouped and ordered", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { makeFrame, submitLap } = await import("./replay");
      const { bestTime, topEntries } = await import("./leaderboard");
      const frames = [makeFrame(0, 0, 0, 0, 0), makeFrame(1000, 5, 5, 0, 10)];

      // Twelve medium laps inserted slowest-first: only the ten fastest rank.
      for (let i = 12; i >= 1; i--) {
        await submitLap(
          `Medium ${i}`,
          "sunset-ridge",
          "medium",
          60_000 + i,
          i === 2 ? frames : null,
        );
      }
      await submitLap("Storm", "stormhaven", "hard", 70_000, null);
      await submitLap("Easy", "sunset-ridge", "easy", 90_000, null);

      const entries = await topEntries();
      expect(
        entries.map(({ track, difficulty, name }) => `${track}/${difficulty}/${name}`),
      ).toEqual([
        "stormhaven/hard/Storm",
        "sunset-ridge/easy/Easy",
        ...Array.from({ length: 10 }, (_, i) => `sunset-ridge/medium/Medium ${i + 1}`),
      ]);
      expect(entries.filter((entry) => entry.hasReplay).map((entry) => entry.name)).toEqual([
        "Medium 2",
      ]);
      expect(await bestTime("sunset-ridge", "medium")).toBe(60_001);
      expect(await bestTime("stormhaven", "easy")).toBeNull();
    });
  }, 15_000);
});

// The Rival ladder rules live in the standings SQL, so only a real Postgres can prove them.
describe.skipIf(!testDatabaseUrl)("standings", () => {
  it("offers the slowest replay-bearing lap by another driver that beats their best", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { makeFrame, submitLap } = await import("./replay");
      const { standings } = await import("./leaderboard");
      const frames = [makeFrame(0, 0, 0, 0, 0), makeFrame(1000, 5, 5, 0, 10)];
      const lap = (name: string, timeMs: number, replay: boolean) =>
        submitLap(name, "sunset-ridge", "medium", timeMs, replay ? frames : null);
      await lap("Ace", 50_000, true);
      await lap("Bolt", 55_000, true);
      await lap("No Replay", 58_000, false);
      await lap("Ava", 60_000, true);
      await lap("Dawdle", 70_000, true);
      await lap("Crawl", 90_000, false);
      const rival = async (name: string) =>
        (await standings(name)).find(
          (standing) => standing.track === "sunset-ridge" && standing.difficulty === "medium",
        )?.rival;

      expect(await rival("Ava")).toEqual({ name: "Bolt", timeMs: 55_000 });
      expect(await rival("Bolt")).toEqual({ name: "Ace", timeMs: 50_000 });
      expect(await rival("Ace")).toBeNull();
      // A newcomer starts on the slowest lap a Pacer can drive.
      expect(await rival("Newcomer")).toEqual({ name: "Dawdle", timeMs: 70_000 });
    });
  }, 15_000);

  it("reports every board, each laddered only by its own Track and Difficulty", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { makeFrame, submitLap } = await import("./replay");
      const { standings } = await import("./leaderboard");
      const frames = [makeFrame(0, 0, 0, 0, 0), makeFrame(1000, 5, 5, 0, 10)];
      await submitLap("Ava", "sunset-ridge", "medium", 60_000, frames);
      await submitLap("Bolt", "sunset-ridge", "medium", 55_000, frames);
      // Nearer to Ava's 60 s than Bolt, but on other boards.
      await submitLap("Hardy", "sunset-ridge", "hard", 59_000, frames);
      await submitLap("Storm", "stormhaven", "medium", 59_500, frames);

      expect(await standings("Ava")).toEqual([
        { track: "arrowhead", difficulty: "easy", bestMs: null, rival: null },
        { track: "arrowhead", difficulty: "hard", bestMs: null, rival: null },
        { track: "arrowhead", difficulty: "medium", bestMs: null, rival: null },
        { track: "stormhaven", difficulty: "easy", bestMs: null, rival: null },
        { track: "stormhaven", difficulty: "hard", bestMs: null, rival: null },
        {
          track: "stormhaven",
          difficulty: "medium",
          bestMs: null,
          rival: { name: "Storm", timeMs: 59_500 },
        },
        { track: "sunset-ridge", difficulty: "easy", bestMs: null, rival: null },
        {
          track: "sunset-ridge",
          difficulty: "hard",
          bestMs: null,
          rival: { name: "Hardy", timeMs: 59_000 },
        },
        {
          track: "sunset-ridge",
          difficulty: "medium",
          bestMs: 60_000,
          rival: { name: "Bolt", timeMs: 55_000 },
        },
      ]);
    });
  }, 15_000);
});
