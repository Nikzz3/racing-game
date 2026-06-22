import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/racing";

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

export async function initDb(): Promise<void> {
  // Fresh installs get the per-difficulty shape directly (composite keys on
  // best_laps/replays). See docs/adr/0001-segregate-leaderboard-by-difficulty.md.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      difficulty TEXT NOT NULL DEFAULT 'medium'
    );
    CREATE TABLE IF NOT EXISTS best_laps (
      name TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      date TIMESTAMPTZ NOT NULL DEFAULT now(),
      difficulty TEXT NOT NULL DEFAULT 'medium',
      s1_ms INTEGER,
      s2_ms INTEGER,
      s3_ms INTEGER,
      PRIMARY KEY (name, difficulty)
    );
    CREATE TABLE IF NOT EXISTS replays (
      name TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      frames JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      difficulty TEXT NOT NULL DEFAULT 'medium',
      PRIMARY KEY (name, difficulty)
    );
  `);

  // Migrate pre-feature installs: add the difficulty column (existing rows
  // backfill to 'medium' via the default) and widen the primary key from
  // (name) to (name, difficulty). Idempotent so it is safe on every boot.
  await pool.query(`
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE best_laps DROP CONSTRAINT IF EXISTS best_laps_pkey;
    ALTER TABLE best_laps ADD PRIMARY KEY (name, difficulty);
    ALTER TABLE replays ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE replays DROP CONSTRAINT IF EXISTS replays_pkey;
    ALTER TABLE replays ADD PRIMARY KEY (name, difficulty);
  `);

  // Sector splits live alongside the lap time. Nullable so pre-replay rows can
  // remain on the board with no derivable splits — see ADR 0002.
  await pool.query(`
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS s1_ms INTEGER;
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS s2_ms INTEGER;
    ALTER TABLE best_laps ADD COLUMN IF NOT EXISTS s3_ms INTEGER;
  `);
}
