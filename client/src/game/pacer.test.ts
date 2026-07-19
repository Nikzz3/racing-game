import { describe, it, expect } from "vitest";
import type { ReplayFrame } from "@racing/shared";
import { pacerPoseAt } from "./pacer";

const frames: ReplayFrame[] = [
  [0,   0,  0,  0, 0],
  [100, 10, 20, 1, 5],
  [200, 30, 40, 2, 10],
];

describe("pacerPoseAt", () => {
  it("returns null when frames are empty", () => {
    expect(pacerPoseAt([], null, 100)).toBeNull();
  });

  it("returns null when startMs is null", () => {
    expect(pacerPoseAt(frames, null, 100)).toBeNull();
  });

  it("returns null when nowMs is before startMs (negative elapsed)", () => {
    expect(pacerPoseAt(frames, 500, 400)).toBeNull();
  });

  it("returns null when elapsed exceeds the last frame time (recording ended)", () => {
    // last frame t=200; elapsed 201 > 200 → pacer should despawn
    expect(pacerPoseAt(frames, 0, 201)).toBeNull();
  });

  it("returns a pose at elapsed 0 (first frame)", () => {
    const pose = pacerPoseAt(frames, 1000, 1000)!;
    expect(pose).not.toBeNull();
    expect(pose.x).toBe(0);
    expect(pose.z).toBe(0);
    expect(pose.heading).toBe(0);
    expect(pose.speed).toBe(0);
  });

  it("returns the final pose at exactly the last frame time", () => {
    const pose = pacerPoseAt(frames, 0, 200)!;
    expect(pose).not.toBeNull();
    expect(pose.x).toBe(30);
    expect(pose.z).toBe(40);
    expect(pose.speed).toBe(10);
  });

  it("returns interpolated pose mid-recording", () => {
    // elapsed = 150 → halfway between t=100 and t=200
    const pose = pacerPoseAt(frames, 0, 150)!;
    expect(pose).not.toBeNull();
    expect(pose.x).toBe(20);   // lerp(10, 30, 0.5)
    expect(pose.z).toBe(30);   // lerp(20, 40, 0.5)
    expect(pose.speed).toBe(7.5); // lerp(5, 10, 0.5)
  });

  it("startMs offsets the clock correctly", () => {
    // startMs=1000, nowMs=1100 → elapsed=100 → exact second frame
    const pose = pacerPoseAt(frames, 1000, 1100)!;
    expect(pose).not.toBeNull();
    expect(pose.x).toBe(10);
    expect(pose.z).toBe(20);
  });
});
