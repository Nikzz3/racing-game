import type { ReplayFrame } from "@racing/shared";

export interface Pose {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Follow the shortest arc, including headings that cross the ±π boundary. */
export function interpolateHeading(
  from: number,
  to: number,
  amount: number,
): number {
  const turn = Math.PI * 2;
  let delta = (to - from) % turn;
  if (delta > Math.PI) delta -= turn;
  if (delta < -Math.PI) delta += turn;
  return from + delta * amount;
}

/** Sample a sorted recording in logarithmic time, clamped to its endpoints. */
export function interpolatePose(frames: ReplayFrame[], t: number): Pose {
  if (frames.length === 0)
    throw new Error("interpolatePose: frames must not be empty");

  let lower = 0;
  let upper = Math.max(0, frames.length - 2);
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (frames[middle][0] <= t) lower = middle;
    else upper = middle - 1;
  }

  const [start, x0, z0, heading0, speed0] = frames[lower];
  const [end, x1, z1, heading1, speed1] =
    frames[Math.min(lower + 1, frames.length - 1)];
  const amount =
    end > start ? Math.max(0, Math.min(1, (t - start) / (end - start))) : 0;
  return {
    x: x0 + (x1 - x0) * amount,
    z: z0 + (z1 - z0) * amount,
    heading: interpolateHeading(heading0, heading1, amount),
    speed: speed0 + (speed1 - speed0) * amount,
  };
}
