/**
 * Golden reference trajectories for the Python physics port (rl/tests/test_golden.py).
 * Each scenario replays an input sequence from the fixed spawn through the real
 * TypeScript CarPhysics; the per-step (x, z, heading, speed) is what Python must match.
 *
 * Usage: npx tsx rl/gen_golden.ts   (JSON array of scenarios on stdout)
 */
import { replayInputs } from "../client/src/game/harness.ts";
import type { Difficulty } from "@racing/shared";
import type { CarInput } from "../client/src/game/input.ts";

const repeat = (length: number, input: CarInput): CarInput[] => Array.from({ length }, () => input);
const throttle = (length: number, steer = 0) => repeat(length, { throttle: 1, brake: 0, steer });

const SCENARIOS: { name: string; difficulty: Difficulty; inputs: CarInput[] }[] = [
  // Acceleration, drag, speed cap.
  { name: "straight_throttle_medium", difficulty: "medium", inputs: throttle(120) },
  // Steer hard right into the barrier: clamp plus one-time speed penalty.
  { name: "wall_collision_medium", difficulty: "medium", inputs: throttle(200, 1) },
  // Moderate steer across the road edge, staying short of the wall: grass friction and cap.
  { name: "off_track_grass_medium", difficulty: "medium", inputs: [...throttle(80, 0.55), ...throttle(80)] },
  // Brake from rest into negative speed.
  { name: "reverse_medium", difficulty: "medium", inputs: repeat(120, { throttle: 0, brake: 1, steer: 0 }) },
  { name: "straight_throttle_easy", difficulty: "easy", inputs: throttle(120) },
  { name: "straight_throttle_hard", difficulty: "hard", inputs: throttle(120) },
];

const output = SCENARIOS.map(({ name, difficulty, inputs }) => ({
  name,
  difficulty,
  inputs,
  trajectory: replayInputs(inputs, { difficulty }).trajectory,
}));

process.stdout.write(JSON.stringify(output));
