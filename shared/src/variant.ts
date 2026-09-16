/**
 * A Variant is a purely cosmetic car body (see CONTEXT.md): one of the Kenney
 * Car Kit models (CC0, kenney.nl). It travels in `hello` and rides in every
 * PlayerSnapshot so remote clients render it; no physics or leaderboard impact.
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
 * Unlike asDifficulty() this never coerces to a specific car: an omitted or
 * unknown value is `undefined`, and rendering falls back to hash-of-player-id.
 */
export function asVariant(value: unknown): Variant | undefined {
  return isVariant(value) ? value : undefined;
}
