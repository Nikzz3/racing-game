import { describe, it, expect } from 'vitest';
import {
  asTrackSlug,
  DEFAULT_TRACK_SLUG,
  getTrack,
  nearestCenterline,
  NUM_CHECKPOINTS,
  SUNSET_RIDGE,
  STORMHAVEN,
  TRACKS,
  trackPath,
  CHECKPOINT_RADIUS,
} from '@racing/shared';

describe('track registry', () => {
  it('DEFAULT_TRACK_SLUG is sunset-ridge', () => {
    expect(DEFAULT_TRACK_SLUG).toBe('sunset-ridge');
  });

  it('TRACKS contains at least one entry', () => {
    expect(TRACKS.length).toBeGreaterThan(0);
  });

  it('getTrack returns SUNSET_RIDGE for sunset-ridge', () => {
    expect(getTrack('sunset-ridge')).toBe(SUNSET_RIDGE);
  });

  it('getTrack returns undefined for an unknown slug', () => {
    expect(getTrack('unknown-track')).toBeUndefined();
  });

  it('asTrackSlug coerces an unknown slug to sunset-ridge', () => {
    expect(asTrackSlug('unknown-track')).toBe('sunset-ridge');
  });

  it('asTrackSlug coerces undefined to sunset-ridge', () => {
    expect(asTrackSlug(undefined)).toBe('sunset-ridge');
  });

  it('asTrackSlug coerces null to sunset-ridge', () => {
    expect(asTrackSlug(null)).toBe('sunset-ridge');
  });

  it('asTrackSlug passes through a valid slug unchanged', () => {
    expect(asTrackSlug('sunset-ridge')).toBe('sunset-ridge');
  });

  it('SUNSET_RIDGE checkpoint count equals NUM_CHECKPOINTS (12 evenly-spaced gates)', () => {
    expect(SUNSET_RIDGE.checkpoints.length).toBe(NUM_CHECKPOINTS);
  });

  it('SUNSET_RIDGE samples array has the expected length', () => {
    expect(SUNSET_RIDGE.samples.length).toBe(512);
  });

  it('TRACKS contains exactly two entries', () => {
    expect(TRACKS.length).toBe(2);
  });

  it('getTrack returns STORMHAVEN for stormhaven', () => {
    expect(getTrack('stormhaven')).toBe(STORMHAVEN);
  });

  it('asTrackSlug passes through stormhaven unchanged', () => {
    expect(asTrackSlug('stormhaven')).toBe('stormhaven');
  });

  it('STORMHAVEN has the correct id and name', () => {
    expect(STORMHAVEN.id).toBe('stormhaven');
    expect(STORMHAVEN.name).toBe('Stormhaven Circuit');
  });

  it('STORMHAVEN checkpoint count equals its control-point count (one gate per apex)', () => {
    expect(STORMHAVEN.checkpoints.length).toBe(STORMHAVEN.controlPoints.length);
  });

  it('each Stormhaven checkpoint lies within CHECKPOINT_RADIUS of the centerline', () => {
    for (const cp of STORMHAVEN.checkpoints) {
      const { dist } = nearestCenterline(cp.x, cp.z, STORMHAVEN.samples);
      expect(dist).toBeLessThanOrEqual(CHECKPOINT_RADIUS);
    }
  });

  it('Stormhaven checkpoints are in travel order (nearest sample indices are strictly ascending)', () => {
    const indices = STORMHAVEN.checkpoints.map(
      (cp) => nearestCenterline(cp.x, cp.z, STORMHAVEN.samples).index
    );
    for (let i = 0; i < indices.length - 1; i++) {
      expect(indices[i]).toBeLessThan(indices[i + 1]);
    }
  });

  it('Stormhaven checkpoint 0 maps to sample 0 (start/finish)', () => {
    const { index } = nearestCenterline(
      STORMHAVEN.checkpoints[0].x,
      STORMHAVEN.checkpoints[0].z,
      STORMHAVEN.samples
    );
    expect(index).toBe(0);
  });

  it('Stormhaven chord/arc ratio for every consecutive checkpoint pair is ≥ 0.8 (anti-cut regression guard)', () => {
    const cps = STORMHAVEN.checkpoints;
    const samples = STORMHAVEN.samples;
    const n = samples.length;
    const cpIndices = cps.map((cp) => nearestCenterline(cp.x, cp.z, samples).index);
    const THRESHOLD = 0.8;

    for (let k = 0; k < cps.length; k++) {
      const kNext = (k + 1) % cps.length;
      const cp1 = cps[k];
      const cp2 = cps[kNext];
      const chord = Math.hypot(cp2.x - cp1.x, cp2.z - cp1.z);

      // Walk the centerline from this checkpoint's sample to the next, summing segment lengths.
      const startIdx = cpIndices[k];
      const endIdx = cpIndices[kNext];
      let arc = 0;
      let idx = startIdx;
      while (idx !== endIdx) {
        const nextIdx = (idx + 1) % n;
        arc += Math.hypot(samples[nextIdx].x - samples[idx].x, samples[nextIdx].z - samples[idx].z);
        idx = nextIdx;
      }

      if (arc === 0) continue; // degenerate: two CPs at same sample
      expect(chord / arc).toBeGreaterThanOrEqual(THRESHOLD);
    }
  });

  it('STORMHAVEN samples array has 512 entries', () => {
    expect(STORMHAVEN.samples.length).toBe(512);
  });

  it('STORMHAVEN has 29 control points', () => {
    expect(STORMHAVEN.controlPoints.length).toBe(29);
  });
});

describe('trackPath', () => {
  it('returns a string starting with M (moveto)', () => {
    const path = trackPath(SUNSET_RIDGE);
    expect(path.startsWith('M')).toBe(true);
  });

  it('returns a closed path containing Z', () => {
    const path = trackPath(SUNSET_RIDGE);
    expect(path).toContain('Z');
  });

  it('works for Stormhaven Circuit too', () => {
    const path = trackPath(STORMHAVEN);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Z');
  });

  it('includes a start/finish marker after Z', () => {
    const path = trackPath(SUNSET_RIDGE);
    const afterZ = path.split('Z')[1] ?? '';
    expect(afterZ.trimStart().startsWith('M')).toBe(true);
  });
});
