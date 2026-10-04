import { describe, it, expect } from "vitest";
import {
  BARRIER_OFFSET,
  reachedCheckpoint,
  ROAD_HALF_WIDTH,
  STORMHAVEN,
  SUNSET_RIDGE,
  type TrackSample,
} from "@racing/shared";

/** A point `lateral` metres left of `along` metres past a gate. */
function offset(gate: TrackSample, along: number, lateral: number) {
  return {
    x: gate.x + gate.dirX * along - gate.dirZ * lateral,
    z: gate.z + gate.dirZ * along + gate.dirX * lateral,
  };
}

describe.each([SUNSET_RIDGE, STORMHAVEN])("reachedCheckpoint on $id", (track) => {
  const cps = track.checkpoints;
  const n = cps.length;
  const reach = (next: number, p: { x: number; z: number }) =>
    reachedCheckpoint(cps, next, p.x, p.z);

  it("never passes over a gate for a car driving anywhere on the road", () => {
    for (const lateral of [-ROAD_HALF_WIDTH, 0, ROAD_HALF_WIDTH]) {
      let next = 0;
      for (let i = 0; i <= track.samples.length * 4; i++) {
        const a = track.samples[Math.floor(i / 4) % track.samples.length];
        const b = track.samples[(Math.floor(i / 4) + 1) % track.samples.length];
        const f = (i % 4) / 4;
        const s = { ...a, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
        const reached = reach(next, offset(s, 0, lateral));
        if (reached === null) continue;
        expect(reached).toBe(next);
        next = (next + 1) % n;
      }
      expect(next).toBe(1);
    }
  });

  it("reaches a later gate, passing over the missed ones", () => {
    expect(reach(2, cps[4])).toBe(4);
  });

  it("reaches the start/finish from the final stretch of the lap", () => {
    expect(reach(n - 2, cps[0])).toBe(0);
  });

  it("never looks past the start/finish into the next lap", () => {
    expect(reach(0, cps[1])).toBeNull();
    expect(reach(n - 1, cps[1])).toBeNull();
  });

  it("ignores gates more than half a lap ahead, so reversing over the line reaches nothing", () => {
    expect(reach(1, cps[n - 1])).toBeNull();
    expect(reach(1, offset(cps[0], 1, 0))).toBeNull();
  });

  it("catches a car passing the start/finish beside the road, out to the barriers", () => {
    const edge = ROAD_HALF_WIDTH + BARRIER_OFFSET - 0.5;
    for (const lateral of [-edge, edge]) {
      expect(reach(0, offset(cps[0], -1, lateral))).toBeNull();
      expect(reach(0, offset(cps[0], 1, lateral))).toBe(0);
    }
  });

  it("lets a car pass beside any other gate", () => {
    expect(reach(1, offset(cps[1], 1, ROAD_HALF_WIDTH + 3))).toBeNull();
  });
});
