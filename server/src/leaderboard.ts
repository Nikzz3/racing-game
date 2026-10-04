import {
  DIFFICULTIES,
  TRACKS,
  type Difficulty,
  type LeaderboardEntry,
  type Standing,
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

/**
 * A driver name's Standing on every (track, difficulty) board. The Rival is the
 * slowest replay-bearing lap that beats the driver's best, so each rung of the
 * ladder is the nearest one up; a driver new to a board starts at its slowest.
 * The driver's own lap is the bound, so it never qualifies, and with no lap of
 * their own the bound is INTEGER's max. Either way each board walks
 * best_laps_board_idx down from that bound, so the cost follows the number of
 * boards, not the laps on them.
 */
export async function standings(name: string): Promise<Standing[]> {
  const { rows } = await pool.query(
    `SELECT boards_track.track, boards_difficulty.difficulty, own.time_ms AS best_ms,
            rival.name AS rival_name, rival.time_ms AS rival_ms
     FROM unnest($1::text[]) AS boards_track(track)
     CROSS JOIN unnest($2::text[]) AS boards_difficulty(difficulty)
     LEFT JOIN best_laps own
       ON own.name = $3
       AND own.track = boards_track.track
       AND own.difficulty = boards_difficulty.difficulty
     LEFT JOIN LATERAL (
       SELECT name, time_ms FROM best_laps
       WHERE best_laps.track = boards_track.track
         AND best_laps.difficulty = boards_difficulty.difficulty
         AND best_laps.time_ms < COALESCE(own.time_ms, 2147483647)
         AND EXISTS (
           SELECT 1 FROM replays r
           WHERE r.name = best_laps.name
             AND r.track = best_laps.track
             AND r.difficulty = best_laps.difficulty
         )
       ORDER BY time_ms DESC
       LIMIT 1
     ) rival ON true
     ORDER BY boards_track.track ASC, boards_difficulty.difficulty ASC`,
    [TRACKS.map((track) => track.id), DIFFICULTIES, name],
  );
  return rows.map((r) => ({
    track: r.track as TrackSlug,
    difficulty: r.difficulty as Difficulty,
    bestMs: r.best_ms,
    rival: r.rival_name === null ? null : { name: r.rival_name, timeMs: r.rival_ms },
  }));
}
