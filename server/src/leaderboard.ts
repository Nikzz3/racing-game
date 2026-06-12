import type { LeaderboardEntry } from "@racing/shared";
import { pool } from "./db";

export async function topEntries(n = 10): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query(
    `SELECT b.name, b.time_ms, b.date, (r.name IS NOT NULL) AS has_replay
     FROM best_laps b LEFT JOIN replays r ON r.name = b.name
     ORDER BY b.time_ms ASC LIMIT $1`,
    [n]
  );
  return rows.map((r) => ({
    name: r.name,
    timeMs: r.time_ms,
    date: new Date(r.date).toISOString(),
    hasReplay: r.has_replay,
  }));
}
