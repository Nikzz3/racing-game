import { pool } from "./db";

/**
 * Where Jev's daily decision count survives a restart (ADR-0009 invariant 2):
 * without it every deploy would hand out a fresh daily budget.
 */
export interface JevUsageStore {
  /** Decisions already counted on `day` (a UTC date, `YYYY-MM-DD`). */
  decisionsOn(day: string): Promise<number>;
  /** Count `decisions` more on `day`. */
  add(day: string, decisions: number): Promise<void>;
}

/** The `jev_usage` table, one row per UTC day (created in `initDb`). */
export const postgresJevUsage: JevUsageStore = {
  async decisionsOn(day) {
    const { rows } = await pool.query<{ decisions: number }>(
      "SELECT decisions FROM jev_usage WHERE day = $1",
      [day],
    );
    return rows[0]?.decisions ?? 0;
  },
  async add(day, decisions) {
    await pool.query(
      `INSERT INTO jev_usage (day, decisions) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET decisions = jev_usage.decisions + EXCLUDED.decisions`,
      [day, decisions],
    );
  },
};
