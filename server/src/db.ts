import { Pool } from "pg";

// A database that stops answering fails each query within seconds instead of
// holding its caller (a Room's race call, a board's write queue) forever.
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/racing",
  connectionTimeoutMillis: 5_000,
  // Postgres cancels a slow statement itself; the client gives up on one it never hears back about.
  statement_timeout: 10_000,
  query_timeout: 15_000,
});

// pg emits 'error' on idle clients (server restart, dropped connection); with
// no listener that is an unhandled 'error' event and crashes the process.
pool.on("error", (err) => console.error("Postgres pool error:", err));

export async function initDb(): Promise<void> {
  // Fresh installs get the per-(track, difficulty) shape directly (composite
  // keys on best_laps/replays). See docs/adr/0001-segregate-leaderboard-by-difficulty.md.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      difficulty TEXT NOT NULL DEFAULT 'medium',
      track TEXT NOT NULL DEFAULT 'sunset-ridge'
    );
    CREATE TABLE IF NOT EXISTS best_laps (
      name TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      date TIMESTAMPTZ NOT NULL DEFAULT now(),
      difficulty TEXT NOT NULL DEFAULT 'medium',
      track TEXT NOT NULL DEFAULT 'sunset-ridge',
      variant TEXT,
      PRIMARY KEY (name, track, difficulty)
    );
    CREATE TABLE IF NOT EXISTS replays (
      name TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      frames JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      difficulty TEXT NOT NULL DEFAULT 'medium',
      track TEXT NOT NULL DEFAULT 'sunset-ridge',
      variant TEXT,
      PRIMARY KEY (name, track, difficulty)
    );
  `);

  // Migrate pre-feature installs: add difficulty/track (existing rows backfill
  // to 'medium'/'sunset-ridge' via the defaults) and widen the best_laps/replays
  // primary key from (name) to (name, track, difficulty). variant is nullable
  // with no default: NULL means the car driven is unknown (rows predating #126)
  // and clients render the name-hash fallback. Idempotent, so it runs on every boot;
  // the primary keys are rebuilt only while they still have the old one-column shape.
  await pool.query(`
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'sunset-ridge';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'sunset-ridge';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS variant TEXT;
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'sunset-ridge';
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS variant TEXT;
    DO $$
    BEGIN
      IF (SELECT indnkeyatts FROM pg_index
          WHERE indrelid = 'best_laps'::regclass AND indisprimary) IS DISTINCT FROM 3 THEN
        ALTER TABLE best_laps DROP CONSTRAINT IF EXISTS best_laps_pkey;
        ALTER TABLE best_laps ADD PRIMARY KEY (name, track, difficulty);
      END IF;
      IF (SELECT indnkeyatts FROM pg_index
          WHERE indrelid = 'replays'::regclass AND indisprimary) IS DISTINCT FROM 3 THEN
        ALTER TABLE replays DROP CONSTRAINT IF EXISTS replays_pkey;
        ALTER TABLE replays ADD PRIMARY KEY (name, track, difficulty);
      END IF;
    END $$;
  `);

  // Serves each board's top N (topEntries) and its Track Record (bestTime) as
  // an index range read instead of a scan and sort of every lap ever set.
  await pool.query(
    "CREATE INDEX IF NOT EXISTS best_laps_board_idx ON best_laps (track, difficulty, time_ms)",
  );
  // Serves a race call's grid Pacers (fastestReplays) the same way, in its ORDER BY.
  await pool.query(
    "CREATE INDEX IF NOT EXISTS replays_board_idx ON replays (track, difficulty, time_ms, name)",
  );

  // Each driver's fastest Plausible Lap per Daily Challenge, keyed by its UTC day.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_laps (
      day DATE NOT NULL,
      name TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      date TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (day, name)
    );
    CREATE INDEX IF NOT EXISTS daily_laps_board_idx ON daily_laps (day, time_ms);
  `);
}
