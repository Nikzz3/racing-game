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

  it.skipIf(!policyExists)('always drives police — the AI\'s canonical car, never a recorded value', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    expect(lap?.variant).toBe('police');
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

  it.skipIf(!policyExists)('frame spatial values match the timed-lap trajectory (rounded)', () => {
    const policy = loadPolicy();
    const lap = buildReferenceLap(policy);
    const result = runPolicyLap(policy);
    expect(lap).not.toBeNull();
    expect(result).not.toBeNull();
    if (!lap || !result) return;

    const lapSteps = Math.round(result.lapTimeMs / DT_MS);
    const lapTraj = result.trajectory.slice(result.steps - 1 - lapSteps);

    expect(lap.frames.length).toBe(lapTraj.length);

    for (let i = 0; i < lap.frames.length; i++) {
      const frame = lap.frames[i];
      const step = lapTraj[i];
      // x and z: 2dp; heading (rot): 3dp; speed: 2dp — mirrors round() in reference-lap.ts
      expect(frame[1]).toBe(Math.round(step.x * 100) / 100);
      expect(frame[2]).toBe(Math.round(step.z * 100) / 100);
      expect(frame[3]).toBe(Math.round(step.heading * 1000) / 1000);
      expect(frame[4]).toBe(Math.round(step.speed * 100) / 100);
    }
  }, 120_000);
});
