import { expect, test as base } from "@playwright/test";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  type Difficulty,
  type TrackSlug,
} from "@racing/shared";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * The `(Track, Difficulty)` pair a Track Record is segregated by (see CONTEXT.md).
 * Defaults to the pair a Room is created with.
 */
export interface TrackRecordScope {
  track: TrackSlug;
  difficulty: Difficulty;
}

export const DEFAULT_SCOPE: TrackRecordScope = {
  track: DEFAULT_TRACK_SLUG,
  difficulty: DEFAULT_DIFFICULTY,
};

export interface BestLapRow extends QueryResultRow {
  name: string;
  time_ms: number;
}

export interface SeedBestLapOptions {
  name: string;
  timeMs: number;
  track?: TrackSlug;
  difficulty?: Difficulty;
  withReplay?: boolean;
}

export interface DbFixture {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  seedBestLap(options: SeedBestLapOptions): Promise<void>;
  /** Track Records held by `name` within one `(Track, Difficulty)` scope. */
  bestLapFor(name: string, scope?: TrackRecordScope): Promise<BestLapRow[]>;
}

interface TestFixtures {
  db: DbFixture;
  resetDatabase: void;
}

interface WorkerFixtures {
  databasePool: Pool;
}

/**
 * The suite erases rooms, best_laps, and replays, so it must never run against a
 * database nobody marked disposable. scripts/test-e2e.ts grants the flag for the
 * throwaway container it provisions (or after the caller opts in for an external
 * E2E_DATABASE_URL); this backstop catches Playwright invocations that bypass
 * the wrapper with a hand-set DATABASE_URL.
 */
function assertDatabaseIsDisposable(): void {
  if (process.env.E2E_DATABASE_ALLOW_TRUNCATE !== "1") {
    throw new Error(
      "Refusing to truncate the e2e database: E2E_DATABASE_ALLOW_TRUNCATE=1 is not set. " +
        "Run the suite through `npm run test:e2e`, or set the flag yourself only if " +
        "every row in the target database is disposable.",
    );
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  databasePool: [
    async ({}, use) => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL must be set by the e2e test runner");
      }
      assertDatabaseIsDisposable();

      const pool = new Pool({ connectionString });
      try {
        await use(pool);
        // Don't leave the final test's writes behind after the run.
        await pool.query("TRUNCATE rooms, best_laps, replays");
      } finally {
        await pool.end();
      }
    },
    { scope: "worker" },
  ],

  // Shared-DB truncation relies on playwright.config.ts keeping workers at 1.
  // If the suite becomes parallel, provision a separate database per worker.
  resetDatabase: [
    async ({ databasePool }, use) => {
      assertDatabaseIsDisposable();
      await databasePool.query("TRUNCATE rooms, best_laps, replays");
      await use();
    },
    { auto: true },
  ],

  db: async ({ databasePool, resetDatabase: _resetDatabase }, use) => {
    const db: DbFixture = {
      query: (text, values) => databasePool.query(text, values),
      async bestLapFor(name, scope = DEFAULT_SCOPE) {
        const result = await databasePool.query<BestLapRow>(
          `SELECT name, time_ms FROM best_laps
           WHERE name = $1 AND track = $2 AND difficulty = $3`,
          [name, scope.track, scope.difficulty],
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
          `INSERT INTO best_laps (name, time_ms, track, difficulty)
           VALUES ($1, $2, $3, $4)`,
          [name, timeMs, track, difficulty],
        );

        if (withReplay) {
          await databasePool.query(
            `INSERT INTO replays (name, time_ms, frames, track, difficulty)
             VALUES ($1, $2, $3, $4, $5)`,
            [name, timeMs, JSON.stringify([]), track, difficulty],
          );
        }
      },
    };

    await use(db);
  },
});

export { expect };
