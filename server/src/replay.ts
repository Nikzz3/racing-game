import { asVariant, type Difficulty, type ReplayFrame, type TrackSlug, type Variant } from "@racing/shared";
import { pool } from "./db";

/** Cap a recording at 20 Hz x 5 minutes; longer laps drop their replay. */
export const MAX_REPLAY_FRAMES = 6000;

const round = (n: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function makeFrame(
  t: number,
  x: number,
  z: number,
  rot: number,
  speed: number
): ReplayFrame {
  return [Math.round(t), round(x, 2), round(z, 2), round(rot, 3), round(speed, 2)];
}

/**
 * Record a lap time and, transactionally, its replay. Returns true if the
 * leaderboard changed (new or improved entry). When `frames` is null the
 * recording was invalid, so any stale replay for this name is removed so it
 * never sits next to a newer best time.
 *
 * `variant` snapshots the cosmetic car driven for THIS lap (see CONTEXT.md):
 * it is whitelist-validated here — missing or invalid becomes NULL — and a
 * later Lobby pick never rewrites old rows; only an improved lap re-snapshots.
 */
export async function submitLap(
  name: string,
  track: TrackSlug,
  difficulty: Difficulty,
  timeMs: number,
  frames: ReplayFrame[] | null,
  variant?: Variant
): Promise<boolean> {
  const storedVariant = asVariant(variant) ?? null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO best_laps (name, track, difficulty, time_ms, date, variant)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (name, track, difficulty) DO UPDATE
         SET time_ms = EXCLUDED.time_ms, date = EXCLUDED.date, variant = EXCLUDED.variant
       WHERE best_laps.time_ms > EXCLUDED.time_ms`,
      [name, track, difficulty, timeMs, storedVariant]
    );
    const changed = (result.rowCount ?? 0) > 0;
    if (!changed) {
      await client.query("COMMIT");
      return false;
    }
    if (frames) {
      await client.query(
        `INSERT INTO replays (name, track, difficulty, time_ms, frames, created_at, variant)
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), $6)
         ON CONFLICT (name, track, difficulty) DO UPDATE
           SET time_ms = EXCLUDED.time_ms, frames = EXCLUDED.frames, created_at = EXCLUDED.created_at,
               variant = EXCLUDED.variant`,
        [name, track, difficulty, timeMs, JSON.stringify(frames), storedVariant]
      );
    } else {
      await client.query(
        "DELETE FROM replays WHERE name = $1 AND track = $2 AND difficulty = $3",
        [name, track, difficulty]
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getReplay(
  name: string,
  track: TrackSlug,
  difficulty: Difficulty
): Promise<{ timeMs: number; frames: ReplayFrame[]; variant?: Variant } | null> {
  const { rows } = await pool.query(
    "SELECT time_ms, frames, variant FROM replays WHERE name = $1 AND track = $2 AND difficulty = $3",
    [name, track, difficulty]
  );
  if (rows.length === 0) return null;
  return {
    timeMs: rows[0].time_ms,
    frames: rows[0].frames as ReplayFrame[],
    // Re-whitelist on the way out so a stored string is never echoed raw:
    // NULL (legacy rows) and anything unknown normalize to absent.
    variant: asVariant(rows[0].variant),
  };
}
