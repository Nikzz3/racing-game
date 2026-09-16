import pg from "pg";

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/racing",
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
  // and clients render the name-hash fallback. Idempotent, so it runs on every boot.
  await pool.query(`
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'sunset-ridge';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'sunset-ridge';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS variant TEXT;
    ALTER TABLE best_laps DROP CONSTRAINT IF EXISTS best_laps_pkey;
    ALTER TABLE best_laps ADD PRIMARY KEY (name, track, difficulty);
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT 'sunset-ridge';
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS variant TEXT;
    ALTER TABLE replays DROP CONSTRAINT IF EXISTS replays_pkey;
    ALTER TABLE replays ADD PRIMARY KEY (name, track, difficulty);
  `);
}
