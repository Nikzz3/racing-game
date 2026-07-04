/**
 * Generates golden reference trajectories for Python physics port fidelity tests.
 * Each scenario is a sequence of inputs replayed from the fixed spawn; the resulting
 * trajectory (x, z, heading, speed per step) is the reference the Python port must match.
 *
 * Usage: npx tsx rl/gen_golden.ts
 * Output: JSON array of scenarios to stdout.
 */
import { replayInputs } from '../client/src/game/harness.ts';
import type { CarInput } from '../client/src/game/input.ts';

type Difficulty = 'easy' | 'medium' | 'hard';

interface Scenario {
  name: string;
  difficulty: Difficulty;
  inputs: CarInput[];
}

const SCENARIOS: Scenario[] = [
  // --- basic physics: acceleration, drag, speed cap ---
  {
    name: 'straight_throttle_medium',
    difficulty: 'medium',
    inputs: Array.from({ length: 120 }, () => ({ throttle: 1, brake: 0, steer: 0 })),
  },
  // --- wall collision: steer hard right + throttle, car hits barrier ---
  {
    name: 'wall_collision_medium',
    difficulty: 'medium',
    inputs: [
      ...Array.from({ length: 200 }, () => ({ throttle: 1, brake: 0, steer: 1 as number })),
    ],
  },
  // --- off-track / grass: moderate steer to cross road edge, stay below wall ---
  {
    name: 'off_track_grass_medium',
    difficulty: 'medium',
    inputs: [
      ...Array.from({ length: 80 }, () => ({ throttle: 1, brake: 0, steer: 0.55 as number })),
      ...Array.from({ length: 80 }, () => ({ throttle: 1, brake: 0, steer: 0 })),
    ],
  },
  // --- reverse: brake from rest into negative speed ---
  {
    name: 'reverse_medium',
    difficulty: 'medium',
    inputs: Array.from({ length: 120 }, () => ({ throttle: 0, brake: 1, steer: 0 })),
  },
  // --- difficulty variants ---
  {
    name: 'straight_throttle_easy',
    difficulty: 'easy',
    inputs: Array.from({ length: 120 }, () => ({ throttle: 1, brake: 0, steer: 0 })),
  },
  {
    name: 'straight_throttle_hard',
    difficulty: 'hard',
    inputs: Array.from({ length: 120 }, () => ({ throttle: 1, brake: 0, steer: 0 })),
  },
];

const output = SCENARIOS.map(({ name, difficulty, inputs }) => {
  const { trajectory } = replayInputs(inputs, { difficulty });
  return { name, difficulty, inputs, trajectory };
});

process.stdout.write(JSON.stringify(output));
