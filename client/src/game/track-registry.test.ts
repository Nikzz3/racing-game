import { describe, it, expect } from 'vitest';
import {
  asTrackSlug,
  DEFAULT_TRACK_SLUG,
  getTrack,
  NUM_CHECKPOINTS,
  SUNSET_RIDGE,
  TRACKS,
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
});
