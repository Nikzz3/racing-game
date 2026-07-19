import { describe, it, expect } from 'vitest';
import type { ReplayFrame } from '@racing/shared';
import { interpolatePose } from './pose-interpolation';

const frames: ReplayFrame[] = [
  [0,   0,  0,  0, 0],
  [100, 10, 20, 1, 5],
  [200, 30, 40, 2, 10],
];

describe('interpolatePose', () => {
  it('clamps to first frame when t is before the first frame', () => {
    const pose = interpolatePose(frames, -50);
    expect(pose.x).toBe(0);
    expect(pose.z).toBe(0);
    expect(pose.heading).toBe(0);
    expect(pose.speed).toBe(0);
  });

  it('returns exact frame values when t lands exactly on a frame', () => {
    const pose = interpolatePose(frames, 100);
    expect(pose.x).toBe(10);
    expect(pose.z).toBe(20);
    expect(pose.heading).toBe(1);
    expect(pose.speed).toBe(5);
  });

  it('linearly lerps x, z, and speed between two frames', () => {
    const pose = interpolatePose(frames, 150); // halfway between t=100 and t=200
    expect(pose.x).toBe(20);      // lerp(10, 30, 0.5)
    expect(pose.z).toBe(30);      // lerp(20, 40, 0.5)
    expect(pose.speed).toBe(7.5); // lerp(5, 10, 0.5)
  });

  it('clamps to last frame when t is after the last frame', () => {
    const pose = interpolatePose(frames, 999);
    expect(pose.x).toBe(30);
    expect(pose.z).toBe(40);
    expect(pose.heading).toBe(2);
    expect(pose.speed).toBe(10);
  });

  it('uses shortest-arc heading interpolation across the ±π boundary', () => {
    // rot goes from just below +π to just above -π — the short arc crosses the wrap
    const wrapFrames: ReplayFrame[] = [
      [0,   0, 0, 3.1,  0],
      [100, 0, 0, -3.1, 0],
    ];
    const pose = interpolatePose(wrapFrames, 50); // a = 0.5
    // d = (-3.1 - 3.1) % (2π) ≈ -6.2; d < -π → d += 2π → d ≈ 0.083
    // heading = 3.1 + 0.083 * 0.5 ≈ π
    expect(pose.heading).toBeCloseTo(Math.PI, 4);
  });
});
