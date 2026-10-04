import { DIFFICULTIES, type Difficulty } from "./difficulty";
import { TRACKS, type TrackSlug } from "./track";
import { CAR_VARIANTS, type Variant } from "./variant";

/**
 * The look of a Daily Challenge's world: sky, sun, light and fog. Purely
 * visual (CONTEXT.md "Daily Challenge"); every other Room renders "sunset".
 */
export const SCENE_PRESETS = ["sunset", "golden-hour", "dusk", "foggy-morning"] as const;

export type ScenePreset = (typeof SCENE_PRESETS)[number];

/** One shared challenge per UTC day, derived from the date alone (CONTEXT.md). */
export interface DailyChallenge {
  /** 1 on DAILY_EPOCH, counting up by one each UTC day. */
  number: number;
  /** The UTC day it runs, as YYYY-MM-DD. */
  date: string;
  track: TrackSlug;
  difficulty: Difficulty;
  variant: Variant;
  scene: ScenePreset;
}

/** The UTC day of Daily #1, the day the Daily Challenge was released. */
export const DAILY_EPOCH = "2026-10-04";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The challenge running at `now` (epoch ms); it rolls over at UTC midnight. */
export function dailyChallenge(now: number): DailyChallenge {
  const day = Math.floor(now / DAY_MS);
  const random = mulberry32(day);
  const pick = <T>(options: readonly T[]): T => options[Math.floor(random() * options.length)];
  return {
    number: day - Date.parse(DAILY_EPOCH) / DAY_MS + 1,
    date: new Date(day * DAY_MS).toISOString().slice(0, 10),
    track: pick(TRACKS).id,
    difficulty: pick(DIFFICULTIES),
    variant: pick(CAR_VARIANTS),
    scene: pick(SCENE_PRESETS),
  };
}

/** When `challenge` closes: the UTC midnight after its day, in epoch ms. */
export function dailyEndsAt(challenge: DailyChallenge): number {
  return Date.parse(challenge.date) + DAY_MS;
}

// A small seeded PRNG: neighbouring days get unrelated picks.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
