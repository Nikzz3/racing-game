import { describe, it, expect } from 'vitest';
import {
  asTrackSlug,
  DEFAULT_TRACK_SLUG,
  getTrack,
  NUM_CHECKPOINTS,
  SUNSET_RIDGE,
  STORMHAVEN,
  TRACKS,
  trackPath,
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

  it('SUNSET_RIDGE derives the correct global number of checkpoints', () => {
    expect(SUNSET_RIDGE.checkpoints.length).toBe(NUM_CHECKPOINTS);
  });

  it('each Track in the registry derives the correct number of checkpoints', () => {
    for (const track of TRACKS) {
      expect(track.checkpoints.length).toBe(NUM_CHECKPOINTS);
    }
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

  it('STORMHAVEN derives the correct global number of checkpoints', () => {
    expect(STORMHAVEN.checkpoints.length).toBe(NUM_CHECKPOINTS);
  });

  it('STORMHAVEN samples array has 512 entries', () => {
    expect(STORMHAVEN.samples.length).toBe(512);
  });

  it('STORMHAVEN has 24 control points', () => {
    expect(STORMHAVEN.controlPoints.length).toBe(24);
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
