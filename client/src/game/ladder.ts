import {
  bestMedal,
  VARIANT_UNLOCKS,
  medalBeats,
  medalFor,
  medalTimes,
  variantUnlocked,
  type Difficulty,
  type Medal,
  type Standing,
  type TrackSlug,
  type Variant,
} from "@racing/shared";

export type Rival = NonNullable<Standing["rival"]>;

/** The Room's (Track, Difficulty) leaderboard. */
export interface Board {
  track: TrackSlug;
  difficulty: Difficulty;
}

export interface MedalAward {
  medal: Medal;
  /** The best lap that earned it. */
  lapMs: number;
  /** Variants the Medal unlocked, easiest tier first. */
  unlocked: Variant[];
}

/** Offer the next Rival as the Pacer, or, the Rival being raced was beaten, move up without asking. */
export type RivalStep = { kind: "offer"; rival: Rival } | { kind: "beaten"; next: Rival | null };

export interface LadderStep {
  award: MedalAward | null;
  rival: RivalStep | null;
}

export function standingOn(
  standings: readonly Standing[],
  { track, difficulty }: Board,
): Standing | undefined {
  return standings.find((s) => s.track === track && s.difficulty === difficulty);
}

function award(
  before: readonly Standing[],
  after: readonly Standing[],
  board: Board,
): MedalAward | null {
  const times = medalTimes(board.track, board.difficulty);
  const previous = standingOn(before, board),
    current = standingOn(after, board);
  // Without a previous Standing nothing is known to be new.
  if (!times || !previous || current?.bestMs == null) return null;
  const medal = medalFor(times, current.bestMs);
  if (!medal || !medalBeats(medal, medalFor(times, previous.bestMs))) return null;
  const [was, is] = [bestMedal(before), bestMedal(after)];
  const unlocked = (Object.keys(VARIANT_UNLOCKS) as Variant[]).filter(
    (variant) => !variantUnlocked(variant, was) && variantUnlocked(variant, is),
  );
  return { medal, lapMs: current.bestMs, unlocked };
}

function rivalStep(
  chased: Rival | null,
  current: Standing,
  pacer: string | null,
): RivalStep | null {
  // The Pacer is the ladder's Rival when it is the one the previous Standing named.
  if (chased && chased.name === pacer && current.bestMs !== null && current.bestMs < chased.timeMs)
    return { kind: "beaten", next: current.rival };
  if (current.rival && current.rival.name !== pacer) return { kind: "offer", rival: current.rival };
  return null;
}

/**
 * What the Standings answering one of the driver's laps change on the Room's board:
 * a better Medal (and the Variants it unlocked), and the Rival ladder's next step for
 * a driver whose current Pacer is named `pacer`.
 */
export function ladderStep(
  before: readonly Standing[],
  after: readonly Standing[],
  board: Board,
  pacer: string | null,
): LadderStep {
  const current = standingOn(after, board);
  if (!current) return { award: null, rival: null };
  return {
    award: award(before, after, board),
    rival: rivalStep(standingOn(before, board)?.rival ?? null, current, pacer),
  };
}
