import type { ReplayFrame } from "@racing/shared";

export interface Pose {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/**
 * Returns the interpolated pose from `frames` at lap-relative time `t`.
 * Clamps to the first/last frame when `t` is out of range.
 * No Three.js dependency — safe to share between ReplayViewer and the Pacer overlay.
 */
export function interpolatePose(frames: ReplayFrame[], t: number): Pose {
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1][0] <= t) {
    i++;
  }
  const f0 = frames[i];
  const f1 = frames[Math.min(i + 1, frames.length - 1)];
  const span = f1[0] - f0[0];
  const a = span > 0 ? Math.max(0, Math.min(1, (t - f0[0]) / span)) : 0;

  const x = f0[1] + (f1[1] - f0[1]) * a;
  const z = f0[2] + (f1[2] - f0[2]) * a;
  const speed = f0[4] + (f1[4] - f0[4]) * a;

  // Shortest-arc heading: wrap delta into (-π, π].
  let d = (f1[3] - f0[3]) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const heading = f0[3] + d * a;

  return { x, z, heading, speed };
}
