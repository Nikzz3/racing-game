import type { Difficulty, LeaderboardEntry, TrackSlug } from "@racing/shared";
import { pool } from "./db";

const TOP_N = 10;

/** Top entries for every (track, difficulty) pair, flattened. */
export async function topEntries(): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query(
    `SELECT name, time_ms, date, difficulty, track, has_replay FROM (
       SELECT b.name, b.time_ms, b.date, b.difficulty, b.track,
              (r.name IS NOT NULL) AS has_replay,
              ROW_NUMBER() OVER (
                PARTITION BY b.track, b.difficulty ORDER BY b.time_ms ASC
              ) AS rn
       FROM best_laps b
       LEFT JOIN replays r ON r.name = b.name AND r.track = b.track AND r.difficulty = b.difficulty
     ) ranked
     WHERE rn <= $1
     ORDER BY track ASC, difficulty ASC, time_ms ASC`,
    [TOP_N],
  );
  return rows.map((r) => ({
    name: r.name,
    timeMs: r.time_ms,
    date: new Date(r.date).toISOString(),
    hasReplay: r.has_replay,
    difficulty: r.difficulty as Difficulty,
    track: r.track as TrackSlug,
  }));
}

/** Current Track Record time for a (track, difficulty) pair, or null if none set yet. */
export async function bestTime(track: TrackSlug, difficulty: Difficulty): Promise<number | null> {
  const { rows } = await pool.query(
    "SELECT MIN(time_ms) AS best FROM best_laps WHERE track = $1 AND difficulty = $2",
    [track, difficulty],
  );
  return rows[0]?.best ?? null;
}
