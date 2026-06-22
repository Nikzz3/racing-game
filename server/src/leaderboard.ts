import type { Difficulty, LeaderboardEntry, SectorSplits } from "@racing/shared";
import { pool } from "./db";

/** Top `n` entries for every difficulty, flattened. Each entry carries its difficulty. */
export async function topEntries(n = 10): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query(
    `SELECT name, time_ms, date, difficulty, has_replay FROM (
       SELECT b.name, b.time_ms, b.date, b.difficulty,
              (r.name IS NOT NULL) AS has_replay,
              ROW_NUMBER() OVER (
                PARTITION BY b.difficulty ORDER BY b.time_ms ASC
              ) AS rn
       FROM best_laps b
       LEFT JOIN replays r ON r.name = b.name AND r.difficulty = b.difficulty
     ) ranked
     WHERE rn <= $1
     ORDER BY difficulty ASC, time_ms ASC`,
    [n]
  );
  return rows.map((r) => ({
    name: r.name,
    timeMs: r.time_ms,
    date: new Date(r.date).toISOString(),
    hasReplay: r.has_replay,
    difficulty: r.difficulty as Difficulty,
  }));
}

/** Current track-record time for a single difficulty, or null if none set yet. */
export async function bestTime(difficulty: Difficulty): Promise<number | null> {
  const { rows } = await pool.query(
    "SELECT MIN(time_ms) AS best FROM best_laps WHERE difficulty = $1",
    [difficulty]
  );
  return rows[0]?.best ?? null;
}

function asSplits(row: { s1_ms: number | null; s2_ms: number | null; s3_ms: number | null }): SectorSplits | null {
  if (row.s1_ms === null || row.s2_ms === null || row.s3_ms === null) return null;
  return { s1Ms: row.s1_ms, s2Ms: row.s2_ms, s3Ms: row.s3_ms };
}

/**
 * The sector-split references locked at a driver's lap start: their own PB and
 * the track record on this difficulty. TR is null when the driver IS the TR
 * holder (deltas would be identical to PB) or when no record-with-splits exists.
 */
export async function loadReferences(
  name: string,
  difficulty: Difficulty
): Promise<{ pb: SectorSplits | null; tr: SectorSplits | null }> {
  const [pbRes, trRes] = await Promise.all([
    pool.query(
      "SELECT s1_ms, s2_ms, s3_ms FROM best_laps WHERE name = $1 AND difficulty = $2",
      [name, difficulty]
    ),
    pool.query(
      `SELECT name, s1_ms, s2_ms, s3_ms FROM best_laps
       WHERE difficulty = $1
       ORDER BY time_ms ASC LIMIT 1`,
      [difficulty]
    ),
  ]);
  const pb = pbRes.rows[0] ? asSplits(pbRes.rows[0]) : null;
  const trRow = trRes.rows[0];
  const tr = !trRow || trRow.name === name ? null : asSplits(trRow);
  return { pb, tr };
}
