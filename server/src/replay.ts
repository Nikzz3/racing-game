import type { ReplayFrame } from "@racing/shared";
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
  timeMs: number,
  frames: ReplayFrame[] | null
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO best_laps (name, time_ms, date)
       VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE SET time_ms = EXCLUDED.time_ms, date = EXCLUDED.date
       WHERE best_laps.time_ms > EXCLUDED.time_ms`,
      [name, timeMs]
    );
    const changed = (result.rowCount ?? 0) > 0;
    if (!changed) {
      await client.query("COMMIT");
      return false;
    }
    if (frames) {
      await client.query(
        `INSERT INTO replays (name, time_ms, frames, created_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (name) DO UPDATE
           SET time_ms = EXCLUDED.time_ms, frames = EXCLUDED.frames, created_at = EXCLUDED.created_at`,
        [name, timeMs, JSON.stringify(frames)]
      );
    } else {
      await client.query("DELETE FROM replays WHERE name = $1", [name]);
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
  name: string
): Promise<{ timeMs: number; frames: ReplayFrame[] } | null> {
  const { rows } = await pool.query(
    "SELECT time_ms, frames FROM replays WHERE name = $1",
    [name]
  );
  if (rows.length === 0) return null;
  return { timeMs: rows[0].time_ms, frames: rows[0].frames as ReplayFrame[] };
}
