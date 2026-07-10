import type { ReplayFrame, TrackSlug } from '@racing/shared';
import { SUNSET_RIDGE } from '@racing/shared';
import { runPolicyLap, type PolicyWeights } from './harness';

const DT_MS = 1000 / 60;

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export interface ReferenceLap {
  name: 'AI Record';
  track: TrackSlug;
  timeMs: number;
  frames: ReplayFrame[];
}

/**
 * Build a reference lap from the exported policy weights.
 * Runs runPolicyLap (the same function used by the Node validation harness), then
 * converts each physics step of the timed-lap portion into a ReplayFrame
 * [t, x, z, rot, speed] where t = stepIndex * 1000/60 ms, starting at t=0.
 * Returns null if the policy fails to complete a lap within maxSteps.
 */
export function buildReferenceLap(policy: PolicyWeights): ReferenceLap | null {
  const result = runPolicyLap(policy, { track: SUNSET_RIDGE });
  if (!result) return null;

  // Trim trajectory to the timed-lap portion only.
  // CheckpointTracker starts timing when CP0 is first crossed (lapStartStep),
  // and stops at the second crossing. steps-1 is the completion step, so:
  // lapStartStep = steps - 1 - round(lapTimeMs / DT_MS)
  const lapSteps = Math.round(result.lapTimeMs / DT_MS);
  const lapTrajectory = result.trajectory.slice(result.steps - 1 - lapSteps);

  const frames: ReplayFrame[] = lapTrajectory.map((s, i) => [
    i * DT_MS,
    round(s.x, 2),
    round(s.z, 2),
    round(s.heading, 3),
    round(s.speed, 2),
  ]);

  return { name: 'AI Record', track: SUNSET_RIDGE.id, timeMs: result.lapTimeMs, frames };
}
