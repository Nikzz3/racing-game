import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { vi } from "vitest";

/**
 * Opt-in Postgres for tests: `SERVER_TEST_DATABASE_URL` names a disposable
 * database. Each call owns one randomly named schema, points `DATABASE_URL` at
 * it, and hands back the freshly imported application modules bound to that
 * pool. It never truncates or alters the database's existing tables.
 *
 * Import the modules under test (`./replay`, `./leaderboard`, ...) inside `run`:
 * the module registry is reset first so they bind to this call's pool, which
 * is what lets one file call this more than once.
 */
export const testDatabaseUrl = process.env.SERVER_TEST_DATABASE_URL;

export interface TestDatabase {
  pool: Pool;
  initDb: () => Promise<void>;
}

export async function withTestSchema<T>(run: (db: TestDatabase) => Promise<T>): Promise<T> {
  if (!testDatabaseUrl) throw new Error("SERVER_TEST_DATABASE_URL is not set");
  const url = new URL(testDatabaseUrl);
  if (url.pathname === "/racing") {
    throw new Error("Use a disposable database, not the developer racing database");
  }
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  let applicationPool: Pool | undefined;
  let schemaCreated = false;
  const previousUrl = process.env.DATABASE_URL;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    // db.ts builds its pool at import time, so import it fresh after DATABASE_URL
    // is set; a cached copy from an earlier call would point at a dropped schema.
    vi.resetModules();
    const { pool, initDb } = await import("./db");
    applicationPool = pool;
    return await run({ pool, initDb });
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    try {
      await applicationPool?.end();
      if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
}
