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
