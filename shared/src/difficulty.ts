/**
 * Difficulty is a property of a Room (see CONTEXT.md): a named set of physics
 * rules applied to every player in that room and fixed for its lifetime. The
 * physics numbers themselves live client-side (the server never simulates the
 * car); this module only defines the shared vocabulary.
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

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

/** Coerce arbitrary input to a valid difficulty, falling back to the default. */
export function asDifficulty(value: unknown): Difficulty {
  return isDifficulty(value) ? value : DEFAULT_DIFFICULTY;
}
