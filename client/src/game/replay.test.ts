// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { jevDrivingState, SUNSET_RIDGE, type ReplayFrame, type Variant } from "@racing/shared";
import { LEGACY_RECORD } from "../../../tests/fixtures/legacy-replay";
import type { JevRecording } from "./jev-recording";

vi.mock("./scene", () => ({
  createScene: vi.fn(() => ({
    scene: { add: vi.fn() },
    camera: {},
    renderer: { render: vi.fn() },
    sun: {},
  })),
  disposeRenderer: vi.fn(),
  disposeWorld: vi.fn(),
  updateSun: vi.fn(),
  followCar: vi.fn(),
  snapBehindCar: vi.fn(),
}));
vi.mock("./trackMesh", () => ({ buildTrack: vi.fn() }));
// Spied, not stubbed: the Jev panel must describe each decision's pose only once.
vi.mock("@racing/shared", async (importOriginal) => {
  const shared = await importOriginal<typeof import("@racing/shared")>();
  return { ...shared, jevDrivingState: vi.fn(shared.jevDrivingState) };
});
vi.mock("./car", () => ({
  createCarMesh: vi.fn(() => new THREE.Group()),
  animateCar: vi.fn(),
  disposeCarMesh: vi.fn(),
}));

import { animateCar, createCarMesh, disposeCarMesh } from "./car";
import { disposeWorld } from "./scene";
import { ReplayViewer } from "./replay";
import { pacerPoseAt } from "./pacer";
import { JevPanel } from "../ui/jev-panel";
import { interpolatePose } from "./pose-interpolation";

const FRAMES: ReplayFrame[] = [
  [0, 0, 0, 0, 0],
  [1000, 5, 5, 0, 10],
];

/** Pins the clock at 0 and hands each requested animation frame to the test. */
function captureFrames(handle: number): (now: number) => void {
  let callback: FrameRequestCallback;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
      callback = next;
      return handle;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });
  return (now) => callback(now);
}

function makeViewer(variant: Variant | undefined): ReplayViewer {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new ReplayViewer(parent, "Ava", "sunset-ridge", 61_000, FRAMES, variant, () => {});
}

describe("ReplayViewer variant", () => {
  beforeEach(() => {
    vi.mocked(createCarMesh).mockClear();
  });

  it("renders the recorded Variant, not the driver-name hash", () => {
    const viewer = makeViewer("taxi");
    expect(createCarMesh).toHaveBeenCalledWith("Ava", "Ava", "taxi");
    viewer.dispose();
  });

  it("falls back to the name-hash path when the recorded Variant is absent", () => {
    const viewer = makeViewer(undefined);
    expect(createCarMesh).toHaveBeenCalledWith("Ava", "Ava", undefined);
    viewer.dispose();
  });
});

describe("ReplayViewer lifecycle", () => {
  const frame = captureFrames(7);

  it("holds the last pose and restarts after the finish pause", () => {
    const viewer = makeViewer("taxi");
    const mesh = vi.mocked(createCarMesh).mock.results[0].value;
    frame(1000);
    expect(mesh.position.x).toBe(5);
    expect(document.querySelector<HTMLElement>(".replay-finished")!.hidden).toBe(false);
    frame(2499);
    expect(mesh.position.x).toBe(5);
    frame(2500);
    expect(mesh.position.x).toBe(0);
    expect(document.querySelector<HTMLElement>(".replay-finished")!.hidden).toBe(true);
    viewer.dispose();
  });

  it("cancels animation and releases car and world resources exactly once", () => {
    const viewer = makeViewer("taxi");
    viewer.dispose();
    viewer.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(disposeCarMesh).toHaveBeenCalledOnce();
    expect(disposeWorld).toHaveBeenCalledOnce();
    expect(document.querySelector(".replay-hud")).toBeNull();
  });

  it("rejects empty recordings before attaching DOM or allocating a car", () => {
    const parent = document.createElement("div");
    expect(
      () => new ReplayViewer(parent, "Ava", "sunset-ridge", 0, [], undefined, () => {}),
    ).toThrow("frames must not be empty");
    expect(parent.childElementCount).toBe(0);
    expect(createCarMesh).not.toHaveBeenCalled();
  });
});

/** The decision count the Jev panel shows. */
function decisions(): string | null | undefined {
  return document.querySelector("[data-jev-decisions]")?.textContent;
}

describe("ReplayViewer with Jev's decisions", () => {
  const frame = captureFrames(3);
  // Two decisions on a stretch of Sunset Ridge: the first judged the car 100 ms in.
  const [a, b] = [SUNSET_RIDGE.samples[0], SUNSET_RIDGE.samples[20]];
  const JEV: JevRecording = {
    model: "jev-test",
    timeMs: 1000,
    frames: [
      [0, a.x, a.z, Math.atan2(a.dirX, a.dirZ), 40],
      [1000, b.x, b.z, Math.atan2(b.dirX, b.dirZ), 60],
    ],
    decisions: [
      [100, 0.9, 0.2, 0.8, 0.6],
      [500, 0.1, 0.7, 0.8, 0.4],
    ],
  };
  const seenAt = (t: number) =>
    jevDrivingState(interpolatePose(JEV.frames, t), SUNSET_RIDGE).bend_ahead;

  function makeJevViewer(): ReplayViewer {
    const { timeMs, frames } = JEV;
    return new ReplayViewer(
      document.body,
      "Jev",
      "sunset-ridge",
      timeMs,
      frames,
      "race-future",
      () => {},
      JEV,
    );
  }

  it("shows the decision in force with what Jev saw from the pose it judged", () => {
    const update = vi.spyOn(JevPanel.prototype, "update");
    const viewer = makeJevViewer();
    const panel = document.querySelector(".replay-hud .jev-panel")!;
    expect(panel.textContent).toContain("jev-test");
    expect(decisions()).toBe("0");
    frame(250);
    expect(update).toHaveBeenLastCalledWith({
      decision: { accelerate: 0.9, left: 0.2, pedalConfidence: 0.8, steerConfidence: 0.6 },
      seen: seenAt(100),
      decisions: 1,
    });
    frame(700);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ seen: seenAt(500), decisions: 2 }),
    );
    expect(decisions()).toBe("2");
    viewer.dispose();
  });

  it("describes each decision once, however many frames and loops show it", () => {
    const viewer = makeJevViewer();
    vi.mocked(jevDrivingState).mockClear();
    for (const now of [150, 200, 300, 600, 900]) frame(now);
    expect(jevDrivingState).toHaveBeenCalledTimes(2);
    frame(1000);
    frame(2500);
    for (const now of [2650, 3100]) frame(now);
    expect(jevDrivingState).toHaveBeenCalledTimes(2);
    viewer.dispose();
  });

  it("starts over with the replay loop and leaves with the viewer", () => {
    const viewer = makeJevViewer();
    frame(1000);
    expect(decisions()).toBe("2");
    frame(2500);
    expect(document.querySelectorAll(".jev-panel")).toHaveLength(1);
    expect(decisions()).toBe("0");
    frame(2600);
    expect(decisions()).toBe("1");
    viewer.dispose();
    expect(document.querySelector(".jev-panel")).toBeNull();
  });

  it("shows no Jev panel for a human replay", () => {
    const viewer = makeViewer("taxi");
    expect(document.querySelector(".jev-panel")).toBeNull();
    viewer.dispose();
  });
});

describe("pre-rework recording compatibility", () => {
  const frame = captureFrames(1);

  it.each([undefined, "taxi"] as const)(
    "plays the old writer's frames unchanged with variant %s",
    (variant) => {
      const originalFrames = structuredClone(LEGACY_RECORD.frames);
      const viewer = new ReplayViewer(
        document.body,
        LEGACY_RECORD.name,
        "sunset-ridge",
        LEGACY_RECORD.time_ms,
        LEGACY_RECORD.frames,
        variant,
        () => {},
      );
      expect(createCarMesh).toHaveBeenCalledWith("LegacyDriver", "LegacyDriver", variant);
      const mesh = vi.mocked(createCarMesh).mock.results[0].value;
      frame(25);
      expect(mesh.position.x).toBeCloseTo(-142.075, 6);
      expect(mesh.position.z).toBeCloseTo(38.49, 6);
      expect(mesh.rotation.y).toBeCloseTo(3.141092653589793, 10);
      // The cosmetic HUD scale must never change recorded speed or playback.
      expect(animateCar).toHaveBeenLastCalledWith(mesh, expect.closeTo(83.74, 8), 0, 0.025);
      frame(LEGACY_RECORD.time_ms);
      expect(mesh.position.x).toBe(-144.14);
      expect(document.querySelector(".replay-time")?.textContent).toBe("1:01.234 / 1:01.234");
      frame(LEGACY_RECORD.time_ms + 1500);
      expect(mesh.position.x).toBe(-144.13);
      expect(LEGACY_RECORD.frames).toEqual(originalFrames);
      viewer.dispose();
    },
  );

  it("uses the same old recording and clock as a human pacer", () => {
    const pose = pacerPoseAt(LEGACY_RECORD.frames, 10_000, 10_025)!;
    expect(pose.x).toBeCloseTo(-142.075, 6);
    expect(pose.z).toBeCloseTo(38.49, 6);
    expect(pose.heading).toBeCloseTo(3.141092653589793, 10);
    expect(pose.speed).toBeCloseTo(83.74, 8);
    expect(pacerPoseAt(LEGACY_RECORD.frames, 10_000, 10_000 + LEGACY_RECORD.time_ms)?.speed).toBe(
      82.45,
    );
    expect(pacerPoseAt(LEGACY_RECORD.frames, 10_000, 10_001 + LEGACY_RECORD.time_ms)).toBeNull();
  });
});
