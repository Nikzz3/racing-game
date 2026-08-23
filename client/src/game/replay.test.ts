// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { ReplayFrame, Variant } from "@racing/shared";

vi.mock("./scene", () => ({
  createScene: vi.fn(() => ({
    scene: { add: vi.fn() },
    camera: {},
    renderer: { render: vi.fn() },
    sun: {},
  })),
  disposeRenderer: vi.fn(),
  updateSun: vi.fn(),
  followCar: vi.fn(),
  snapBehindCar: vi.fn(),
}));
vi.mock("./trackMesh", () => ({ buildTrack: vi.fn() }));
vi.mock("./car", () => ({
  createCarMesh: vi.fn(() => new THREE.Group()),
  animateCar: vi.fn(),
}));

import { createCarMesh } from "./car";
import { ReplayViewer } from "./replay";

const FRAMES: ReplayFrame[] = [
  [0, 0, 0, 0, 0],
  [1000, 5, 5, 0, 10],
];

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
    // createCarMesh resolves an absent Variant via the stable name hash, so
    // legacy replays (NULL column) render exactly as they did before #126.
    expect(createCarMesh).toHaveBeenCalledWith("Ava", "Ava", undefined);
    viewer.dispose();
  });
});
