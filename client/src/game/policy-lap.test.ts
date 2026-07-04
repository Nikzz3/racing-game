import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runPolicyLap, runAutopilotLap, policyForward, type PolicyWeights } from './harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, '../../../rl/policy.json');
const policyExists = existsSync(POLICY_PATH);

// Wall-clock lap cap: 36000 steps ≈ 10 min at the 60 fps physics step (dt = 1/60 s).
const MAX_LAP_STEPS = 36000;

function loadPolicy(): PolicyWeights {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf-8')) as PolicyWeights;
}

describe('policyForward', () => {
  it.skipIf(!policyExists)('returns a 2-element action given a 7-element obs', () => {
    const policy = loadPolicy();
    const obs = new Array<number>(7).fill(0);
    const action = policyForward(obs, policy);
    expect(action).toHaveLength(2);
    expect(action[0]).toBeGreaterThanOrEqual(-1);
    expect(action[0]).toBeLessThanOrEqual(1);
    expect(action[1]).toBeGreaterThanOrEqual(-1);
    expect(action[1]).toBeLessThanOrEqual(1);
  });

  it.skipIf(!policyExists)('output is deterministic', () => {
    const policy = loadPolicy();
    const obs = [0.1, 0.2, 0.5, -0.1, 0.3, 0.0, -0.2];
    const a1 = policyForward(obs, policy);
    const a2 = policyForward(obs, policy);
    expect(a1).toEqual(a2);
  });
});

describe('runPolicyLap — Node validation against real TypeScript CarPhysics', () => {
  it.skipIf(!policyExists)(
    'exported policy completes a validated lap from the fixed spawn',
    () => {
      const policy = loadPolicy();
      const result = runPolicyLap(policy, { maxSteps: MAX_LAP_STEPS });

      expect(result).not.toBeNull();
      if (result === null) return;

      expect(result.lapTimeMs).toBeGreaterThan(0);
      // Sanity bounds: must be between 20 s and 10 min
      expect(result.lapTimeMs).toBeGreaterThan(20_000);
      expect(result.lapTimeMs).toBeLessThan(600_000);

      console.log(
        `Policy lap time: ${(result.lapTimeMs / 1000).toFixed(2)} s  ` +
        `(autopilot baseline ≈35.47 s)`
      );
    },
    60_000,  // allow up to 60 s of wall-clock time
  );

  it.skipIf(!policyExists)(
    'headline gate: policy lap beats the rule-based autopilot baseline (Medium, fixed spawn)',
    () => {
      const policy = loadPolicy();
      const policyResult = runPolicyLap(policy, { maxSteps: MAX_LAP_STEPS });
      const autopilotResult = runAutopilotLap({ maxSteps: MAX_LAP_STEPS });

      expect(policyResult).not.toBeNull();
      expect(autopilotResult).not.toBeNull();
      if (policyResult === null || autopilotResult === null) return;

      console.log(
        `Headline gate — policy: ${(policyResult.lapTimeMs / 1000).toFixed(2)} s  ` +
        `autopilot: ${(autopilotResult.lapTimeMs / 1000).toFixed(2)} s`
      );

      // The headline success criterion from PRD #7 issue #11.
      expect(policyResult.lapTimeMs).toBeLessThan(autopilotResult.lapTimeMs);
    },
    120_000,  // allow up to 2 min for both laps
  );
});
