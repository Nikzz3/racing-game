import type { Difficulty, ReplayFrame } from "@racing/shared";
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
 */
export async function submitLap(
  name: string,
  difficulty: Difficulty,
  timeMs: number,
  frames: ReplayFrame[] | null
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO best_laps (name, difficulty, time_ms, date)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (name, difficulty) DO UPDATE SET time_ms = EXCLUDED.time_ms, date = EXCLUDED.date
       WHERE best_laps.time_ms > EXCLUDED.time_ms`,
      [name, difficulty, timeMs]
    );
    const changed = (result.rowCount ?? 0) > 0;
    if (!changed) {
      await client.query("COMMIT");
      return false;
    }
    if (frames) {
      await client.query(
        `INSERT INTO replays (name, difficulty, time_ms, frames, created_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (name, difficulty) DO UPDATE
           SET time_ms = EXCLUDED.time_ms, frames = EXCLUDED.frames, created_at = EXCLUDED.created_at`,
        [name, difficulty, timeMs, JSON.stringify(frames)]
      );
    } else {
      await client.query("DELETE FROM replays WHERE name = $1 AND difficulty = $2", [
        name,
        difficulty,
      ]);
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
  difficulty: Difficulty
): Promise<{ timeMs: number; frames: ReplayFrame[] } | null> {
  const { rows } = await pool.query(
    "SELECT time_ms, frames FROM replays WHERE name = $1 AND difficulty = $2",
    [name, difficulty]
  );
  if (rows.length === 0) return null;
  return { timeMs: rows[0].time_ms, frames: rows[0].frames as ReplayFrame[] };
}
