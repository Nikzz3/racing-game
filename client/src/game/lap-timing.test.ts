import { describe, it, expect } from 'vitest';
import {
  CheckpointTracker,
  runAutopilotLap,
  replayInputs,
  autopilotInput,
} from './harness';
import { CHECKPOINT_RADIUS, NUM_CHECKPOINTS, SUNSET_RIDGE } from '@racing/shared';

const CHECKPOINTS = SUNSET_RIDGE.checkpoints;

// Place the car exactly at a checkpoint's position.
function atCheckpoint(k: number): { x: number; z: number } {
  return { x: CHECKPOINTS[k].x, z: CHECKPOINTS[k].z };
}

describe('CheckpointTracker', () => {
  it('records a lap time when all checkpoints are passed in order', () => {
    const tracker = new CheckpointTracker(CHECKPOINTS);

    // First pass over CP0 starts the timer (returns null).
    const { x: x0, z: z0 } = atCheckpoint(0);
    expect(tracker.update(x0, z0, 0)).toBeNull();

    // Pass CPs 1 through NUM_CHECKPOINTS-1.
    for (let k = 1; k < NUM_CHECKPOINTS; k++) {
      const { x, z } = atCheckpoint(k);
      expect(tracker.update(x, z, k * 60)).toBeNull();
    }

    // Second pass over CP0 completes the lap.
    const lapMs = tracker.update(x0, z0, NUM_CHECKPOINTS * 60);
    expect(lapMs).not.toBeNull();
    expect(lapMs).toBeGreaterThan(0);
    // Each CP took 60 steps = 1 second; NUM_CHECKPOINTS seconds total.
    expect(lapMs).toBeCloseTo(NUM_CHECKPOINTS * 1000, 0);
  });

  it('does not count a lap when a checkpoint is skipped', () => {
    const tracker = new CheckpointTracker(CHECKPOINTS);

    const { x: x0, z: z0 } = atCheckpoint(0);
    tracker.update(x0, z0, 0); // start timer

    // Pass CPs 1–4 in order.
    for (let k = 1; k <= 4; k++) {
      const { x, z } = atCheckpoint(k);
      tracker.update(x, z, k * 60);
    }

    // Skip CP5 and jump to CP6.
    const { x: x6, z: z6 } = atCheckpoint(6);
    expect(tracker.update(x6, z6, 5 * 60)).toBeNull();

    // CP0 again: tracker is still waiting for CP5, so lap is NOT completed.
    const result = tracker.update(x0, z0, 12 * 60);
    expect(result).toBeNull();
  });

  it('does not count the very first crossing of CP0 as a lap', () => {
    const tracker = new CheckpointTracker(CHECKPOINTS);
    const { x, z } = atCheckpoint(0);
    // Fresh tracker — no lapStartStep yet, so crossing CP0 just starts the timer.
    expect(tracker.update(x, z, 0)).toBeNull();
  });

  it('ignores a position that is outside checkpoint radius', () => {
    const tracker = new CheckpointTracker(CHECKPOINTS);
    // Far from any checkpoint.
    expect(tracker.update(9999, 9999, 0)).toBeNull();
    // Tracker's next pointer must not have advanced.
    const { x, z } = atCheckpoint(0);
    expect(tracker.update(x, z, 1)).toBeNull(); // starts timer, next → 1
    expect(tracker.next).toBe(1);
  });
});

describe('autopilot baseline lap', () => {
  it('completes a valid lap from the fixed spawn within a generous step budget', () => {
    const result = runAutopilotLap({ maxSteps: 36000 }); // 10 min at 60 fps
    expect(result).not.toBeNull();
    if (result === null) return;

    expect(result.lapTimeMs).toBeGreaterThan(0);
    // Sanity bounds: the autopilot should not be faster than ~20 s or slower than 5 min.
    expect(result.lapTimeMs).toBeGreaterThan(20_000);
    expect(result.lapTimeMs).toBeLessThan(300_000);

    // Trajectory must contain at least one step.
    expect(result.trajectory.length).toBeGreaterThan(0);

    // Print the baseline so the number is visible in CI logs.
    console.log(`Autopilot baseline lap time: ${(result.lapTimeMs / 1000).toFixed(2)} s`);
  }, 30_000); // allow up to 30 seconds of wall-clock time
});

describe('replayInputs', () => {
  it('emits one state per input step', () => {
    const N = 120;
    const inputs = Array.from({ length: N }, () => ({ throttle: 1, brake: 0, steer: 0 }));
    const { trajectory } = replayInputs(inputs);
    expect(trajectory).toHaveLength(N);
  });

  it('trajectory starts near the fixed spawn position', () => {
    const { trajectory } = replayInputs([{ throttle: 0, brake: 0, steer: 0 }]);
    // SPAWN_SAMPLE is near the start/finish straight (around x≈-45, z≈-210 area)
    const first = trajectory[0];
    expect(first.x).not.toBeNaN();
    expect(first.z).not.toBeNaN();
    // Speed should be ~0 after a single coasting step from rest.
    expect(first.speed).toBeCloseTo(0, 1);
  });

  it('returns lapTimeMs when the input trace completes a valid lap', () => {
    // Run the autopilot to get the recorded inputs, then replay them.
    const lapResult = runAutopilotLap({ maxSteps: 36000 });
    expect(lapResult).not.toBeNull();
    if (lapResult === null) return;

    const { trajectory, lapTimeMs } = replayInputs(lapResult.inputs);
    expect(trajectory).toHaveLength(lapResult.inputs.length);
    expect(lapTimeMs).not.toBeNull();
    // Replay must reproduce the same lap time (deterministic simulation).
    expect(lapTimeMs).toBeCloseTo(lapResult.lapTimeMs, 0);
  });

  it('returns null lapTimeMs when no lap is completed', () => {
    const inputs = Array.from({ length: 60 }, () => ({ throttle: 0, brake: 0, steer: 0 }));
    const { lapTimeMs } = replayInputs(inputs);
    expect(lapTimeMs).toBeNull();
  });
});
