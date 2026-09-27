import { describe, expect, it } from "vitest";
import {
  nearestCenterline,
  RACING_LINE_HALF_WIDTH,
  racingLine,
  racingLineAhead,
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

  it("puts each point N m ahead N m along the line, whatever the sample spacing", () => {
    const longest = Math.max(...line.map((_, i) => segmentTo(line, i)));
    for (let from = 0; from < line.length; from += 17) {
      for (const metres of [15, 25, 40, 70, 190]) {
        const point = racingLineAhead(track, from, metres);
        // Walk the line's own segments to the point nearest the answer.
        let walked = 0;
        let closest = { gap: Infinity, walked: 0 };
        for (let i = from; walked <= metres + 2 * longest; i = (i + 1) % line.length) {
          const gap = Math.hypot(line[i].x - point.x, line[i].z - point.z);
          if (gap < closest.gap) closest = { gap, walked };
          walked += segmentTo(line, i);
        }
        expect(Math.abs(closest.walked - metres)).toBeLessThanOrEqual(longest);
        expect(closest.gap).toBeLessThanOrEqual(longest);
      }
    }
  });

  it("wraps around the end of the loop", () => {
    const last = line.length - 1;
    const point = racingLineAhead(track, last, segmentTo(line, last) + 0.5);
    expect(Math.hypot(point.x - line[0].x, point.z - line[0].z)).toBeCloseTo(0.5, 9);
  });
});

/** Length of the segment from point `i` to the next, wrapping at the end. */
function segmentTo(line: { x: number; z: number }[], i: number): number {
  const [a, b] = [line[i], line[(i + 1) % line.length]];
  return Math.hypot(b.x - a.x, b.z - a.z);
}
