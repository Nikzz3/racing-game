import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildReferenceLap } from './reference-lap';
import { runPolicyLap, type PolicyWeights } from './harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, '../../../rl/policy.json');
const policyExists = existsSync(POLICY_PATH);

const DT_MS = 1000 / 60;

function loadPolicy(): PolicyWeights {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf-8')) as PolicyWeights;
}

describe('buildReferenceLap', () => {
  it.skipIf(!policyExists)('returns a non-null Reference Lap for the shipped policy', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap).not.toBeNull();
  }, 60_000);

  it.skipIf(!policyExists)('name is "AI Record"', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap?.name).toBe('AI Record');
  }, 60_000);

  it.skipIf(!policyExists)('timeMs equals the runPolicyLap lap time', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    const result = runPolicyLap(policy, { maxSteps: 36000 });
    expect(lap).not.toBeNull();
    expect(result).not.toBeNull();
    if (!lap || !result) return;
    expect(lap.timeMs).toBe(result.lapTimeMs);
  }, 120_000);

  it.skipIf(!policyExists)('has one frame per lap step', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap).not.toBeNull();
    if (!lap) return;
    // frames.length = lapSteps + 1 where lapSteps = round(timeMs / DT_MS)
    const expectedFrames = Math.round(lap.timeMs / DT_MS) + 1;
    expect(lap.frames.length).toBe(expectedFrames);
  }, 60_000);

  it.skipIf(!policyExists)('first frame timestamp is 0', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap).not.toBeNull();
    if (!lap) return;
    expect(lap.frames[0][0]).toBe(0);
  }, 60_000);

  it.skipIf(!policyExists)('timestamps ascend at 1000/60 ms spacing', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap).not.toBeNull();
    if (!lap) return;
    for (let i = 1; i < lap.frames.length; i++) {
      expect(lap.frames[i][0] - lap.frames[i - 1][0]).toBeCloseTo(DT_MS, 5);
    }
  }, 60_000);

  it.skipIf(!policyExists)('final timestamp corresponds to the lap time', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap).not.toBeNull();
    if (!lap) return;
    const lastT = lap.frames[lap.frames.length - 1][0];
    expect(lastT).toBeCloseTo(lap.timeMs, 5);
  }, 60_000);

  it.skipIf(!policyExists)('each frame is a well-formed [t, x, z, rot, speed] tuple', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap).not.toBeNull();
    if (!lap) return;
    for (const frame of lap.frames) {
      expect(frame).toHaveLength(5);
      for (const v of frame) {
        expect(typeof v).toBe('number');
        expect(isFinite(v)).toBe(true);
      }
    }
  }, 60_000);
});
