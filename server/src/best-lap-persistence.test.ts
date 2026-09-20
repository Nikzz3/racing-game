import { describe, expect, it } from "vitest";
import { testDatabaseUrl, withTestSchema } from "./test-database";

// The personal-best rule lives in SQL (`ON CONFLICT ... WHERE best_laps.time_ms >
// EXCLUDED.time_ms` in replay.ts), so only a real Postgres can prove it. This used
// to be a browser-driven lap in the e2e suite; see docs/agents/e2e-testing.md.
describe.skipIf(!testDatabaseUrl)("best lap persistence", () => {
  it("a slower lap does not overwrite the driver's better time, replay, or variant", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { getReplay, makeFrame, submitLap } = await import("./replay");
      const { bestTime, topEntries } = await import("./leaderboard");
      const frames = [makeFrame(0, 0, 0, 0, 0), makeFrame(1000, 5, 5, 0, 10)];

      expect(
        await submitLap("Already Faster", "sunset-ridge", "medium", 1_000, frames, "taxi"),
      ).toBe(true);
      expect(
        await submitLap("Already Faster", "sunset-ridge", "medium", 2_000, null, "police"),
      ).toBe(false);

      expect(await bestTime("sunset-ridge", "medium")).toBe(1_000);
      expect(await getReplay("Already Faster", "sunset-ridge", "medium")).toEqual({
        timeMs: 1_000,
        frames,
        variant: "taxi",
      });
      expect(
        (await topEntries()).map(({ name, timeMs, hasReplay }) => ({ name, timeMs, hasReplay })),
      ).toEqual([{ name: "Already Faster", timeMs: 1_000, hasReplay: true }]);
    });
  }, 15_000);

  it("a faster lap replaces the driver's time, replay, and variant", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { getReplay, makeFrame, submitLap } = await import("./replay");
      const { bestTime } = await import("./leaderboard");
      const faster = [makeFrame(0, 0, 0, 0, 0), makeFrame(500, 5, 5, 0, 20)];

      expect(await submitLap("Improving", "sunset-ridge", "medium", 2_000, null, "taxi")).toBe(
        true,
      );
      expect(await submitLap("Improving", "sunset-ridge", "medium", 1_000, faster, "police")).toBe(
        true,
      );

      expect(await bestTime("sunset-ridge", "medium")).toBe(1_000);
      expect(await getReplay("Improving", "sunset-ridge", "medium")).toEqual({
        timeMs: 1_000,
        frames: faster,
        variant: "police",
      });
    });
  }, 15_000);
});
