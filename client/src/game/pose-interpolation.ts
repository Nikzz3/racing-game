import type { ReplayFrame } from "@racing/shared";

export interface Pose {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Follow the shortest arc, including headings that cross the ±π boundary. */
export function interpolateHeading(from: number, to: number, amount: number): number {
  const turn = Math.PI * 2;
  let delta = (to - from) % turn;
  if (delta > Math.PI) delta -= turn;
  if (delta < -Math.PI) delta += turn;
  return from + delta * amount;
}

/** Blend every pose field, writing into `out` so hot paths can avoid allocation. */
export function lerpPose(
  from: Readonly<Pose>,
  to: Readonly<Pose>,
  amount: number,
  out: Pose = { x: 0, z: 0, heading: 0, speed: 0 },
): Pose {
  out.x = from.x + (to.x - from.x) * amount;
  out.z = from.z + (to.z - from.z) * amount;
  out.heading = interpolateHeading(from.heading, to.heading, amount);
  out.speed = from.speed + (to.speed - from.speed) * amount;
  return out;
}

const fromFrame: Pose = { x: 0, z: 0, heading: 0, speed: 0 };
const toFrame: Pose = { x: 0, z: 0, heading: 0, speed: 0 };
function framePose([, x, z, heading, speed]: ReplayFrame, out: Pose): Pose {
  out.x = x;
  out.z = z;
  out.heading = heading;
  out.speed = speed;
  return out;
}

/** Sample a sorted recording in logarithmic time, clamped to its endpoints. */
export function interpolatePose(frames: ReplayFrame[], t: number): Pose {
  if (frames.length === 0) throw new Error("interpolatePose: frames must not be empty");

  let lower = 0;
  let upper = Math.max(0, frames.length - 2);
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (frames[middle][0] <= t) lower = middle;
    else upper = middle - 1;
  }

  const from = frames[lower];
  const to = frames[Math.min(lower + 1, frames.length - 1)];
  const amount = to[0] > from[0] ? Math.max(0, Math.min(1, (t - from[0]) / (to[0] - from[0]))) : 0;
  // Only the returned pose is new: callers may keep it.
  return lerpPose(framePose(from, fromFrame), framePose(to, toFrame), amount);
}
