import type { Difficulty, TrackSlug } from "@racing/shared";
import { expect, test } from "../fixtures/db";

test.describe.serial("database fixture", () => {
  test("seeds typed leaderboard context rows", async ({ db }) => {
    await db.seedBestLap({ name: "Alpha", timeMs: 1_000 });
    await db.seedBestLap({
      name: "Omega",
      timeMs: 9_999_999,
      track: "sunset-ridge",
      difficulty: "hard",
      withReplay: true,
    });

    const { rows } = await db.query<{
      name: string;
      time_ms: number;
      track: TrackSlug;
      difficulty: Difficulty;
      has_replay: boolean;
    }>(`
      SELECT b.name, b.time_ms, b.track, b.difficulty,
             (r.name IS NOT NULL) AS has_replay
      FROM best_laps b
      LEFT JOIN replays r
        ON r.name = b.name AND r.track = b.track AND r.difficulty = b.difficulty
      ORDER BY b.time_ms
    `);

    expect(rows).toEqual([
      {
        name: "Alpha",
        time_ms: 1_000,
        track: "sunset-ridge",
        difficulty: "medium",
        has_replay: false,
      },
      {
        name: "Omega",
        time_ms: 9_999_999,
        track: "sunset-ridge",
        difficulty: "hard",
        has_replay: true,
      },
    ]);
  });

  test("starts the next test with empty tables", async ({ db }) => {
    const [bestLaps, replays] = await Promise.all([
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM best_laps"),
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM replays"),
    ]);

    expect(bestLaps.rows[0].count).toBe("0");
    expect(replays.rows[0].count).toBe("0");
  });
});
