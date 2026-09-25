import { SUNSET_RIDGE, type ReplayFrame, type TrackSlug } from "@racing/shared";
import { lapFrames, runPolicyLap, type PolicyWeights } from "./harness";

export interface ReferenceLap {
  name: "AI Record";
  /** The AI's canonical car (#121): always police, never a recorded value. */
  variant: "police";
  track: TrackSlug;
  timeMs: number;
  frames: ReplayFrame[];
}

/**
 * Drives the policy with the Node validation harness and converts the timed-lap
 * portion into frames at t = step * 1000/60, starting at 0. Null if the policy
 * fails to complete a lap.
 */
export function buildReferenceLap(policy: PolicyWeights): ReferenceLap | null {
  const result = runPolicyLap(policy, { track: SUNSET_RIDGE });
  if (!result) return null;
  return {
    name: "AI Record",
    variant: "police",
    track: SUNSET_RIDGE.id,
    timeMs: result.lapTimeMs,
    frames: lapFrames(result),
  };
}
