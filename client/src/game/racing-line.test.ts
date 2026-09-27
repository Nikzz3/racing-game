import { describe, expect, it } from "vitest";
import {
  nearestCenterline,
  RACING_LINE_HALF_WIDTH,
  racingLine,
  ROAD_HALF_WIDTH,
  STORMHAVEN,
  SUNSET_RIDGE,
  type Track,
} from "@racing/shared";

const length = (points: { x: number; z: number }[]): number =>
  points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length];
    return sum + Math.hypot(next.x - p.x, next.z - p.z);
  }, 0);

describe.each([SUNSET_RIDGE, STORMHAVEN])("racingLine on $name", (track: Track) => {
  const line = racingLine(track);

  it("has one point per centre-line sample, each within the half width of it", () => {
    expect(line).toHaveLength(track.samples.length);
    line.forEach((p, i) => {
      const s = track.samples[i];
      expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThanOrEqual(RACING_LINE_HALF_WIDTH + 1e-9);
      expect(nearestCenterline(p.x, p.z, track.samples).dist).toBeLessThan(ROAD_HALF_WIDTH);
    });
  });

  it("is a closed loop of unit directions pointing at the next point", () => {
    const spacing = length(line) / line.length;
    line.forEach((p, i) => {
      const next = line[(i + 1) % line.length];
      const gap = Math.hypot(next.x - p.x, next.z - p.z);
      // The last point joins the first like any other pair: no seam.
      expect(gap).toBeLessThan(spacing * 3);
      expect(Math.hypot(p.dirX, p.dirZ)).toBeCloseTo(1, 9);
      expect(p.dirX * (next.x - p.x) + p.dirZ * (next.z - p.z)).toBeCloseTo(gap, 9);
    });
  });

  it("cuts the bends: it is shorter than the centre line", () => {
    expect(length(line)).toBeLessThan(length(track.samples));
  });

  it("is deterministic and computed once per track", () => {
    expect(racingLine(track)).toBe(line);
    const copy: Track = {
      ...track,
      samples: track.samples.map((s) => ({ ...s })),
    };
    expect(racingLine(copy)).toEqual(line);
  });
});
