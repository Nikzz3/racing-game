import type { Difficulty, LeaderboardEntry } from "@racing/shared";
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
