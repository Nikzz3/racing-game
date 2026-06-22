import {
  CHECKPOINTS,
  type Difficulty,
  MID_LAP_SECTOR_BOUNDARIES,
  type ReplayFrame,
} from "@racing/shared";
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
 * Approximate the sector splits of a stored lap from its replay frames. For each
 * mid-lap sector boundary checkpoint, finds the frame whose position is nearest
 * the checkpoint and reads its `t` (ms since lap start). Accuracy is bounded by
 * the ~50 ms frame interval, which is fine for splits shown to 0.1 s. Returns
 * null if the derived boundary times are not strictly monotonic — defensive
 * against corrupt or partial recordings.
 */
export function computeSplitsFromFrames(
  frames: ReplayFrame[],
  lapTimeMs: number
): { s1: number; s2: number; s3: number } | null {
  if (frames.length < 2) return null;
  const boundaryTimes = MID_LAP_SECTOR_BOUNDARIES.map((cpIdx) => {
    const cp = CHECKPOINTS[cpIdx];
    let bestT = -1;
    let bestD2 = Infinity;
    for (const f of frames) {
      const [t, x, z] = f;
      const dx = x - cp.x;
      const dz = z - cp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestT = t;
      }
    }
    return bestT;
  });
  const [tCp4, tCp8] = boundaryTimes;
  if (tCp4 <= 0 || tCp8 <= tCp4 || tCp8 >= lapTimeMs) return null;
  return {
    s1: tCp4,
    s2: tCp8 - tCp4,
    s3: lapTimeMs - tCp8,
  };
}

/**
 * Record a lap time, its sector splits, and (transactionally) its replay.
 * Returns true if the leaderboard changed (new or improved entry). When `frames`
 * is null the recording was invalid, so any stale replay for this name is
 * removed so it never sits next to a newer best time. Splits are upserted with
 * the lap time so the two can never disagree.
 */
export async function submitLap(
  name: string,
  difficulty: Difficulty,
  timeMs: number,
  frames: ReplayFrame[] | null,
  splits: { s1: number; s2: number; s3: number }
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO best_laps (name, difficulty, time_ms, s1_ms, s2_ms, s3_ms, date)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (name, difficulty) DO UPDATE SET
         time_ms = EXCLUDED.time_ms,
         s1_ms = EXCLUDED.s1_ms,
         s2_ms = EXCLUDED.s2_ms,
         s3_ms = EXCLUDED.s3_ms,
         date = EXCLUDED.date
       WHERE best_laps.time_ms > EXCLUDED.time_ms`,
      [name, difficulty, timeMs, splits.s1, splits.s2, splits.s3]
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

/**
 * One-shot, idempotent backfill: for every `best_laps` row missing splits that
 * has a stored replay, derive the splits from the replay frames and write them
 * back. Rows without a replay (pre-replay-feature records) stay NULL forever.
 * See ADR 0002.
 */
export async function backfillSplits(): Promise<{ filled: number; unrecoverable: number }> {
  const { rows } = await pool.query(
    `SELECT b.name, b.difficulty, b.time_ms, r.frames
     FROM best_laps b
     JOIN replays r ON r.name = b.name AND r.difficulty = b.difficulty
     WHERE b.s1_ms IS NULL OR b.s2_ms IS NULL OR b.s3_ms IS NULL`
  );
  let filled = 0;
  let unrecoverable = 0;
  for (const row of rows) {
    const splits = computeSplitsFromFrames(row.frames as ReplayFrame[], row.time_ms);
    if (!splits) {
      unrecoverable++;
      continue;
    }
    await pool.query(
      `UPDATE best_laps SET s1_ms = $1, s2_ms = $2, s3_ms = $3
       WHERE name = $4 AND difficulty = $5`,
      [splits.s1, splits.s2, splits.s3, row.name, row.difficulty]
    );
    filled++;
  }
  return { filled, unrecoverable };
}
