import type { JevDecision, ReplayFrame } from "@racing/shared";

/**
 * One decision: [t ms since lap start, P(accelerate), P(left), P(right), pedal
 * confidence, steer confidence]. P(nothing) is what left and right leave over.
 */
export type JevRecordedDecision = [number, number, number, number, number, number];

/** A lap Jev drove, with every decision it made: the bundled Jev Lap. */
export interface JevRecording {
  /** The model that answered, e.g. `jev-1.13.0`. */
  model: string;
  timeMs: number;
  frames: ReplayFrame[];
  /** In time order; a decision holds until the next one. */
  decisions: JevRecordedDecision[];
}

/**
 * The decision in force at `timeMs` — the latest one made at or before it —
 * and how many decisions had been made by then. Null before the first.
 */
export function decisionAt(
  decisions: readonly JevRecordedDecision[],
  timeMs: number,
): { decision: JevDecision; madeAt: number; count: number } | null {
  let lo = 0;
  let hi = decisions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (decisions[mid][0] <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return null;
  const [madeAt, accelerate, left, right, pedalConfidence, steerConfidence] = decisions[lo - 1];
  return {
    decision: { accelerate, left, right, pedalConfidence, steerConfidence },
    madeAt,
    count: lo,
  };
}
