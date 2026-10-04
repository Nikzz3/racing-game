import type { Difficulty } from "./difficulty";
import type { TrackSlug } from "./track";
import type { Variant } from "./variant";

/** Medal tiers, easiest first (see CONTEXT.md). */
export const MEDALS = ["bronze", "silver", "gold", "author"] as const;

export type Medal = (typeof MEDALS)[number];

export const MEDAL_LABELS: Record<Medal, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  author: "Author",
};

/** Target lap time per tier, in ms: a best lap at or under a target earns that Medal. */
export type MedalTimes = Record<Medal, number>;

/**
 * Author time per (Track, Difficulty). Sunset Ridge at Medium is the AI Reference
 * Lap, pinned by a client test against the trained policy; every other board is
 * hand-set just under its Track Record when medals shipped (ADR-0012).
 */
const AUTHOR_MS: Record<string, Record<Difficulty, number>> = {
  "sunset-ridge": { easy: 30_500, medium: 23_800, hard: 22_000 },
  stormhaven: { easy: 39_000, medium: 30_000, hard: 28_500 },
};

// Trackmania's editor defaults: each lower tier is a share of the Author time.
const TIER_FACTOR: Record<Medal, number> = { bronze: 1.5, silver: 1.2, gold: 1.06, author: 1 };

/** Every tier's target on a board, rounded up to whole hundredths; null for an unknown Track. */
export function medalTimes(track: TrackSlug, difficulty: Difficulty): MedalTimes | null {
  const author = AUTHOR_MS[track]?.[difficulty];
  if (author === undefined) return null;
  const at = (medal: Medal) => Math.ceil((author * TIER_FACTOR[medal]) / 10) * 10;
  return { bronze: at("bronze"), silver: at("silver"), gold: at("gold"), author: at("author") };
}

/** The hardest Medal a best lap earned; null without a lap or below Bronze. */
export function medalFor(times: MedalTimes, bestMs: number | null): Medal | null {
  let earned: Medal | null = null;
  for (const medal of MEDALS) if (bestMs !== null && bestMs <= times[medal]) earned = medal;
  return earned;
}

/** The easiest Medal still unearned, i.e. the next target; null once Author is earned. */
export function nextMedal(times: MedalTimes, bestMs: number | null): Medal | null {
  return MEDALS.find((medal) => bestMs === null || bestMs > times[medal]) ?? null;
}

/** True when `a` is a strictly better Medal than `b` (null is no Medal). */
export function medalBeats(a: Medal | null, b: Medal | null): boolean {
  return (a === null ? -1 : MEDALS.indexOf(a)) > (b === null ? -1 : MEDALS.indexOf(b));
}

/**
 * The Medal tier that unlocks each locked Variant, earned on any (Track,
 * Difficulty). Variants absent here are free from the start.
 */
export const VARIANT_UNLOCKS: Partial<Record<Variant, Medal>> = {
  "sedan-sports": "bronze",
  race: "silver",
  police: "gold",
  "race-future": "author",
};

/** Whether a driver whose best Medal anywhere is `best` may drive `variant`. */
export function variantUnlocked(variant: Variant, best: Medal | null): boolean {
  const needed = VARIANT_UNLOCKS[variant];
  return needed === undefined || (best !== null && !medalBeats(needed, best));
}
