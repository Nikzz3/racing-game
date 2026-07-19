import { expect, test as base } from "@playwright/test";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  type Difficulty,
  type TrackSlug,
} from "@racing/shared";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

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
}

interface TestFixtures {
  db: DbFixture;
  resetDatabase: void;
}

interface WorkerFixtures {
  databasePool: Pool;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  databasePool: [
    async ({}, use) => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL must be set by the e2e test runner");
      }

      const pool = new Pool({ connectionString });
      try {
        await use(pool);
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
      await databasePool.query("TRUNCATE rooms, best_laps, replays");
      await use();
    },
    { auto: true },
  ],

  db: async ({ databasePool, resetDatabase: _resetDatabase }, use) => {
    const db: DbFixture = {
      query: (text, values) => databasePool.query(text, values),
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
