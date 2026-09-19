import { describe, expect, it } from "vitest";
import { LEGACY_RECORD } from "../../tests/fixtures/legacy-replay";
import { testDatabaseUrl, withTestSchema } from "./test-database";

describe.skipIf(!testDatabaseUrl)("legacy PostgreSQL records", () => {
  it("migrates old tables without losing records and preserves them during current reads and slower laps", async () => {
    await withTestSchema(async ({ pool, initDb }) => {
      const { getReplay, submitLap } = await import("./replay");
      const { bestTime, topEntries } = await import("./leaderboard");

      // These are the original tables, before the per-track/difficulty keys
      // and nullable cosmetic variant were added.
      await pool.query(`
        CREATE TABLE rooms (
          id TEXT PRIMARY KEY, name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE best_laps (
          name TEXT PRIMARY KEY, time_ms INTEGER NOT NULL,
          date TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE replays (
          name TEXT PRIMARY KEY, time_ms INTEGER NOT NULL, frames JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        "INSERT INTO best_laps (name, time_ms, date) VALUES ($1, $2, $3), ('RecordOnly', 70000, $3)",
        [LEGACY_RECORD.name, LEGACY_RECORD.time_ms, LEGACY_RECORD.date],
      );
      await pool.query(
        "INSERT INTO replays (name, time_ms, frames, created_at) VALUES ($1, $2, $3::jsonb, $4)",
        [
          LEGACY_RECORD.name,
          LEGACY_RECORD.time_ms,
          JSON.stringify(LEGACY_RECORD.frames),
          LEGACY_RECORD.date,
        ],
      );
      await pool.query(
        "INSERT INTO rooms (id, name) VALUES ('legacy-room', 'Old room')",
      );

      await initDb();
      await initDb();

      const originalReplay = {
        timeMs: LEGACY_RECORD.time_ms,
        frames: LEGACY_RECORD.frames,
        variant: undefined,
      };
      expect(
        await getReplay(LEGACY_RECORD.name, "sunset-ridge", "medium"),
      ).toEqual(originalReplay);
      expect(await bestTime("sunset-ridge", "medium")).toBe(
        LEGACY_RECORD.time_ms,
      );
      expect(await topEntries()).toEqual([
        {
          name: LEGACY_RECORD.name,
          timeMs: LEGACY_RECORD.time_ms,
          date: LEGACY_RECORD.date,
          track: "sunset-ridge",
          difficulty: "medium",
          hasReplay: true,
        },
        {
          name: "RecordOnly",
          timeMs: 70000,
          date: LEGACY_RECORD.date,
          track: "sunset-ridge",
          difficulty: "medium",
          hasReplay: false,
        },
      ]);
      expect(
        (
          await pool.query(
            "SELECT track, difficulty FROM rooms WHERE id = 'legacy-room'",
          )
        ).rows,
      ).toEqual([{ track: "sunset-ridge", difficulty: "medium" }]);
      expect(
        (
          await pool.query(
            "SELECT created_at, variant FROM replays WHERE name = $1",
            [LEGACY_RECORD.name],
          )
        ).rows,
      ).toEqual([{ created_at: new Date(LEGACY_RECORD.date), variant: null }]);

      // A slower new lap must not replace the historical time, date, replay,
      // or unknown car variant with today's selected car.
      expect(
        await submitLap(
          LEGACY_RECORD.name,
          "sunset-ridge",
          "medium",
          80000,
          null,
          "taxi",
        ),
      ).toBe(false);
      expect(
        await getReplay(LEGACY_RECORD.name, "sunset-ridge", "medium"),
      ).toEqual(originalReplay);
      expect((await topEntries())[0].date).toBe(LEGACY_RECORD.date);

      // The same old driver can now record another difficulty without touching
      // the migrated entry; post-variant rows retain their chosen body.
      expect(
        await submitLap(
          LEGACY_RECORD.name,
          "sunset-ridge",
          "hard",
          55000,
          LEGACY_RECORD.frames,
          "police",
        ),
      ).toBe(true);
      expect(
        await getReplay(LEGACY_RECORD.name, "sunset-ridge", "hard"),
      ).toEqual({ ...originalReplay, timeMs: 55000, variant: "police" });
      expect(
        await getReplay(LEGACY_RECORD.name, "sunset-ridge", "medium"),
      ).toEqual(originalReplay);
      expect(await bestTime("sunset-ridge", "medium")).toBe(
        LEGACY_RECORD.time_ms,
      );
      expect(
        await getReplay(LEGACY_RECORD.name, "stormhaven", "medium"),
      ).toBeNull();
    });
  }, 15000);
});
