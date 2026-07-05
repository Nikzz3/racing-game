import { describe, it, expect } from 'vitest';
import { checkpointMissed } from './checkpoint-miss';

// Use N=100 for easy mental arithmetic; margin=8.
const N = 100;
const M = 8;

describe('checkpointMissed', () => {
  it('returns false when the owed gate is clearly ahead', () => {
    // Gate at 50, car at 30 — gate is 20 samples ahead.
    expect(checkpointMissed(30, 50, N, M)).toBe(false);
  });

  it('returns true when the car has passed the gate beyond the margin', () => {
    // Gate at 50, car at 65 — 15 samples past (15 > margin 8).
    expect(checkpointMissed(65, 50, N, M)).toBe(true);
  });

  it('returns false when the car is within margin before the gate', () => {
    // Gate at 50, car at 47 — 3 samples before the gate.
    expect(checkpointMissed(47, 50, N, M)).toBe(false);
  });

  it('returns false when the car is within margin after the gate', () => {
    // Gate at 50, car at 55 — 5 samples past (5 <= margin 8).
    expect(checkpointMissed(55, 50, N, M)).toBe(false);
  });

  it('returns false at exactly the margin boundary (non-strict)', () => {
    // Exactly margin samples past — the boundary is exclusive (> not >=).
    expect(checkpointMissed(58, 50, N, M)).toBe(false);
  });

  it('returns true one sample past the margin boundary', () => {
    expect(checkpointMissed(59, 50, N, M)).toBe(true);
  });

  // ---- wrap boundary (gate near sample 0, car near the end) ---------------

  it('returns false when the gate is slightly ahead across the wrap', () => {
    // Gate at sample 5, car at sample 95 — gate is 10 samples ahead wrapping.
    expect(checkpointMissed(95, 5, N, M)).toBe(false);
  });

  it('returns true when the car has just crossed the wrap past the gate', () => {
    // Gate at sample 5, car at sample 20 — 15 samples past (crossed S/F line).
    expect(checkpointMissed(20, 5, N, M)).toBe(true);
  });
});
