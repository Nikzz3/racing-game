import type { DailyBoard, DailyChallenge } from "@racing/shared";
import { pool } from "./db";

/** Entries a Daily board carries, so every broadcast of it stays bounded. */
export const DAILY_BOARD_SIZE = 500;

/**
 * Record a Daily lap for `day` (a challenge's YYYY-MM-DD date), keeping only
 * the driver's fastest that day. Returns true if the board changed.
 */
export async function submitDailyLap(day: string, name: string, timeMs: number): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO daily_laps (day, name, time_ms, date) VALUES ($1, $2, $3, now())
     ON CONFLICT (day, name) DO UPDATE SET time_ms = EXCLUDED.time_ms, date = EXCLUDED.date
     WHERE daily_laps.time_ms > EXCLUDED.time_ms`,
    [day, name, timeMs],
  );
  return (result.rowCount ?? 0) > 0;
}

/** The challenge's board, fastest first; ties go to whoever set the time first. */
export async function dailyBoard(challenge: DailyChallenge): Promise<DailyBoard> {
  // Queried by the date string and never read back: pg parses DATE columns in
  // the server's local time zone, which could shift the day.
  const { rows } = await pool.query(
    "SELECT name, time_ms FROM daily_laps WHERE day = $1 ORDER BY time_ms ASC, date ASC LIMIT $2",
    [challenge.date, DAILY_BOARD_SIZE],
  );
  return { challenge, entries: rows.map((r) => ({ name: r.name, timeMs: r.time_ms })) };
}
