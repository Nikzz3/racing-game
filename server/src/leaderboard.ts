import type { LeaderboardEntry } from "@racing/shared";
import { pool } from "./db";

/** Record a lap time. Returns true if the leaderboard changed (new or improved entry). */
export async function submitTime(
  name: string,
  timeMs: number
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO best_laps (name, time_ms, date)
     VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET time_ms = EXCLUDED.time_ms, date = EXCLUDED.date
     WHERE best_laps.time_ms > EXCLUDED.time_ms`,
    [name, timeMs]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function topEntries(n = 10): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query(
    "SELECT name, time_ms, date FROM best_laps ORDER BY time_ms ASC LIMIT $1",
    [n]
  );
  return rows.map((r) => ({
    name: r.name,
    timeMs: r.time_ms,
    date: new Date(r.date).toISOString(),
  }));
}
