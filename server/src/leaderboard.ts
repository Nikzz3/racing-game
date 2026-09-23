import {
  DIFFICULTIES,
  TRACKS,
  type Difficulty,
  type LeaderboardEntry,
  type TrackSlug,
} from "@racing/shared";
import { pool } from "./db";

const TOP_N = 10;

/**
 * Top entries for every (track, difficulty) pair, flattened. Each board reads
 * its own first TOP_N rows off best_laps_board_idx, so the cost follows the
 * number of boards, not the number of laps ever recorded.
 */
export async function topEntries(): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query(
    `SELECT b.name, b.time_ms, b.date, b.difficulty, b.track,
            (r.name IS NOT NULL) AS has_replay
     FROM unnest($1::text[]) AS boards_track(track)
     CROSS JOIN unnest($2::text[]) AS boards_difficulty(difficulty)
     CROSS JOIN LATERAL (
       SELECT name, time_ms, date, difficulty, track FROM best_laps
       WHERE best_laps.track = boards_track.track
         AND best_laps.difficulty = boards_difficulty.difficulty
       ORDER BY time_ms ASC
       LIMIT $3
     ) b
     LEFT JOIN replays r ON r.name = b.name AND r.track = b.track AND r.difficulty = b.difficulty
     ORDER BY b.track ASC, b.difficulty ASC, b.time_ms ASC`,
    [TRACKS.map((track) => track.id), DIFFICULTIES, TOP_N],
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
