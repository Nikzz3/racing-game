import type { ReplayFrame } from "@racing/shared";

/** Frozen output of makeFrame from pre-rework commit ea4953f. */
export const LEGACY_REPLAY_FRAMES: ReplayFrame[] = [
  [0, -144.13, 38.46, 3.131, 83.33],
  [50, -140.02, 38.52, -3.132, 84.15],
  [125, -133.71, 38.71, -3.11, 85.01],
  [61234, -144.14, 38.47, 3.131, 82.45],
];

/** Database row shape from before track, difficulty, and variant columns existed. */
export const LEGACY_RECORD = {
  name: "LegacyDriver",
  time_ms: 61234,
  date: "2025-04-05T12:34:56.789Z",
  frames: LEGACY_REPLAY_FRAMES,
};
