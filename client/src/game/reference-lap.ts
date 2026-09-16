import { SUNSET_RIDGE, type ReplayFrame, type TrackSlug } from "@racing/shared";
import { runPolicyLap, type PolicyWeights } from "./harness";

const DT_MS = 1000 / 60;

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
  // Timing starts at the first CP0 crossing and stops at the second, which is
  // the completion step (steps - 1).
  const lapSteps = Math.round(result.lapTimeMs / DT_MS);
  const frames = result.trajectory
    .slice(result.steps - 1 - lapSteps)
    .map<ReplayFrame>((s, i) => [
      i * DT_MS,
      round(s.x, 2),
      round(s.z, 2),
      round(s.heading, 3),
      round(s.speed, 2),
    ]);
  return {
    name: "AI Record",
    variant: "police",
    track: SUNSET_RIDGE.id,
    timeMs: result.lapTimeMs,
    frames,
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
