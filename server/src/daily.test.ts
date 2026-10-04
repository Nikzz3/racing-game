import { describe, expect, it } from "vitest";
import { dailyChallenge } from "@racing/shared";
import { testDatabaseUrl, withTestSchema } from "./test-database";

// The fastest-lap-per-driver-per-day rule lives in SQL (`ON CONFLICT ... WHERE
// daily_laps.time_ms > EXCLUDED.time_ms` in daily.ts), so only a real Postgres can prove it.
describe.skipIf(!testDatabaseUrl)("daily board persistence", () => {
  it("keeps each driver's fastest lap of the day, fastest driver first", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { dailyBoard, submitDailyLap } = await import("./daily");
      const today = dailyChallenge(Date.parse("2026-10-05T12:00:00Z"));

      expect(await submitDailyLap(today.date, "Ava", 62_000)).toBe(true);
      expect(await submitDailyLap(today.date, "Ben", 61_000)).toBe(true);
      expect(await submitDailyLap(today.date, "Ava", 63_000)).toBe(false);
      expect(await dailyBoard(today)).toEqual({
        challenge: today,
        entries: [
          { name: "Ben", timeMs: 61_000 },
          { name: "Ava", timeMs: 62_000 },
        ],
      });

      expect(await submitDailyLap(today.date, "Ava", 60_000)).toBe(true);
      expect((await dailyBoard(today)).entries.map((entry) => entry.name)).toEqual(["Ava", "Ben"]);
    });
  }, 15_000);

  it("gives every day its own board", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { dailyBoard, submitDailyLap } = await import("./daily");
      const today = dailyChallenge(Date.parse("2026-10-05T12:00:00Z"));
      const tomorrow = dailyChallenge(Date.parse("2026-10-06T12:00:00Z"));

      await submitDailyLap(today.date, "Ava", 60_000);
      // Slower than yesterday's lap, yet a new day's first lap always counts.
      expect(await submitDailyLap(tomorrow.date, "Ava", 70_000)).toBe(true);

      expect((await dailyBoard(today)).entries).toEqual([{ name: "Ava", timeMs: 60_000 }]);
      expect((await dailyBoard(tomorrow)).entries).toEqual([{ name: "Ava", timeMs: 70_000 }]);
    });
  }, 15_000);
});
