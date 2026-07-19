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
  const [t0, x0, z0, rot0, speed0] = frames[i];
  const [t1, x1, z1, rot1, speed1] = frames[Math.min(i + 1, frames.length - 1)];

  const span = t1 - t0;
  const a = span > 0 ? Math.max(0, Math.min(1, (t - t0) / span)) : 0;

  const x = x0 + (x1 - x0) * a;
  const z = z0 + (z1 - z0) * a;
  const speed = speed0 + (speed1 - speed0) * a;

  // Shortest-arc heading: wrap delta into (-π, π].
  let d = (rot1 - rot0) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const heading = rot0 + d * a;

  return { x, z, heading, speed };
}
