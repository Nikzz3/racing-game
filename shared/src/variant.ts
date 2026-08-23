/**
 * A Variant is a purely cosmetic car body (see CONTEXT.md): one of the Kenney
 * Car Kit models (CC0, kenney.nl). The choice travels in `hello` and rides in
 * every PlayerSnapshot so remote clients render it; it has no physics or
 * leaderboard-key impact.
 */
export const CAR_VARIANTS = [
  "race",
  "race-future",
  "sedan-sports",
  "hatchback-sports",
  "suv",
  "taxi",
  "police",
  "van",
] as const;

export type Variant = (typeof CAR_VARIANTS)[number];

export function isVariant(value: unknown): value is Variant {
  return (CAR_VARIANTS as readonly unknown[]).includes(value);
}

/**
 * Normalize arbitrary input to a Variant or absent. Unlike asDifficulty() this
 * never coerces to a specific car: an omitted or unknown value is `undefined`,
 * and rendering falls back to the client's hash-of-player-id assignment.
 */
export function asVariant(value: unknown): Variant | undefined {
  return isVariant(value) ? value : undefined;
}
