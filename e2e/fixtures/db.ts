import { expect, test as base } from "@playwright/test";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  type Difficulty,
  type TrackSlug,
} from "@racing/shared";
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { assertWorkerProvisioned, clientUrl, workerDatabaseUrl } from "../workers";

export interface BestLapRow extends QueryResultRow {
  name: string;
  time_ms: number;
}

export interface DbFixture {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  seedBestLap(options: {
    name: string;
    timeMs: number;
    track?: TrackSlug;
    difficulty?: Difficulty;
    withReplay?: boolean;
  }): Promise<void>;
  /** Track Records held by `name` in the `(Track, Difficulty)` a Room is created with by default. */
  bestLapFor(name: string): Promise<BestLapRow[]>;
}

const TRUNCATE = "TRUNCATE rooms, best_laps, replays";

export const test = base.extend<{ db: DbFixture }, { databasePool: Pool }>({
  // Each worker talks to its own client, and through it its own server and
  // database (see ../workers.ts), so tests on different workers never share state.
  baseURL: async ({}, use, testInfo) => {
    assertWorkerProvisioned(testInfo.parallelIndex);
    await use(clientUrl(testInfo.parallelIndex));
  },

  databasePool: [
    async ({}, use, workerInfo) => {
      const adminUrl = process.env.DATABASE_URL;
      if (!adminUrl) throw new Error("DATABASE_URL must be set by the e2e test runner");
      assertWorkerProvisioned(workerInfo.parallelIndex);
      const connectionString = workerDatabaseUrl(adminUrl, workerInfo.parallelIndex);
      // scripts/test-e2e.ts grants the flag for the throwaway container it provisions (or
      // after the caller opts in for an external E2E_DATABASE_URL); this backstop catches
      // Playwright invocations that bypass the wrapper with a hand-set DATABASE_URL.
      if (process.env.E2E_DATABASE_ALLOW_TRUNCATE !== "1") {
        throw new Error(
          "Refusing to truncate the e2e database: E2E_DATABASE_ALLOW_TRUNCATE=1 is not set. " +
            "Run the suite through `npm run test:e2e`, or set the flag yourself only if " +
            "every row in the target database is disposable.",
        );
      }

      const pool = new Pool({ connectionString });
      try {
        await use(pool);
        // Don't leave the final test's writes behind after the run.
        await pool.query(TRUNCATE);
      } finally {
        await pool.end();
      }
    },
    { scope: "worker" },
  ],

  // Auto so every test starts from an empty database, whether or not it queries it.
  // Safe under parallel workers only because the pool above is per worker.
  db: [
    async ({ databasePool }, use) => {
      await databasePool.query(TRUNCATE);
      await use({
        query: (text, values) => databasePool.query(text, values),
        async bestLapFor(name) {
          const result = await databasePool.query<BestLapRow>(
            "SELECT name, time_ms FROM best_laps WHERE name = $1 AND track = $2 AND difficulty = $3",
            [name, DEFAULT_TRACK_SLUG, DEFAULT_DIFFICULTY],
          );
          return result.rows;
        },
        async seedBestLap({
          name,
          timeMs,
          track = DEFAULT_TRACK_SLUG,
          difficulty = DEFAULT_DIFFICULTY,
          withReplay = false,
        }) {
          await databasePool.query(
            "INSERT INTO best_laps (name, time_ms, track, difficulty) VALUES ($1, $2, $3, $4)",
            [name, timeMs, track, difficulty],
          );
          if (withReplay) {
            await databasePool.query(
              "INSERT INTO replays (name, time_ms, frames, track, difficulty) VALUES ($1, $2, $3, $4, $5)",
              [name, timeMs, "[]", track, difficulty],
            );
          }
        },
      });
    },
    { auto: true },
  ],
});

export { expect };
