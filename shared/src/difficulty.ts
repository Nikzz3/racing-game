/**
 * Difficulty is a property of a Room (see CONTEXT.md): a named set of physics
 * rules applied to every player in that room and fixed for its lifetime. The
 * physics numbers live client-side (the server never simulates the car), except
 * the per-difficulty top speed, shared so server-side lap plausibility
 * validation can use it (ADR-0005).
 */
export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Medium equals the pre-feature physics; it is the default and the backfill value. */
export const DEFAULT_DIFFICULTY: Difficulty = "medium";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** Top-speed cap per difficulty in m/s, shared by client physics, server validation and the RL harness. */
export const MAX_SPEED_MS: Record<Difficulty, number> = {
  easy: 52,
  medium: 90,
  hard: 110,
};

/** Coerce arbitrary input to a valid difficulty, falling back to the default. */
export function asDifficulty(value: unknown): Difficulty {
  return (DIFFICULTIES as unknown[]).includes(value) ? (value as Difficulty) : DEFAULT_DIFFICULTY;
}
