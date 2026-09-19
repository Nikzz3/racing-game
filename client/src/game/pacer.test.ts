// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { ReplayFrame } from "@racing/shared";

vi.mock("./car", async (importOriginal) => {
  const original = await importOriginal<typeof import("./car")>();
  return { ...original, createCarMesh: vi.fn(), animateCar: vi.fn() };
});

import { createCarMesh, resolveVariant } from "./car";
import { pacerPoseAt, pacerCheckpointTimes, pacerDelta, PacerOverlay } from "./pacer";

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
    expect(pacerPoseAt(frames, 0, 201)).toBeNull();
  });

  it("returns the first, last and interpolated poses relative to startMs", () => {
    expect(pacerPoseAt(frames, 1000, 1000)).toEqual({ x: 0, z: 0, heading: 0, speed: 0 });
    expect(pacerPoseAt(frames, 0, 200)).toMatchObject({ x: 30, z: 40, speed: 10 });
    expect(pacerPoseAt(frames, 0, 150)).toMatchObject({ x: 20, z: 30, speed: 7.5 });
    expect(pacerPoseAt(frames, 1000, 1100)).toMatchObject({ x: 10, z: 20 });
  });
});


describe("pacerCheckpointTimes", () => {
  it("returns an array of nulls when frames are empty", () => {
    const cps = [{ x: 0, z: 0 }, { x: 50, z: 0 }];
    expect(pacerCheckpointTimes([], cps)).toEqual([null, null]);
  });

  it("returns null for a checkpoint the Pacer never reaches within the radius", () => {
    const straightFrames: ReplayFrame[] = [
      [0, 0, 0, 0, 5],
      [1000, 10, 0, 0, 5],
    ];
    const times = pacerCheckpointTimes(straightFrames, [{ x: 200, z: 0 }]);
    expect(times).toEqual([null]);
  });

  it("returns the first frame's time when the scan starts inside the radius", () => {
    const f: ReplayFrame[] = [
      [0,   0, 0, 0, 5],
      [100, 20, 0, 0, 5],
    ];
    const times = pacerCheckpointTimes(f, [{ x: 0, z: 0 }]);
    expect(times[0]).toBe(0);
  });

  it("interpolates the entry time when the Pacer crosses the radius boundary between frames", () => {
    // (-20,0) → (4,0) over 200 ms enters the default radius 8 at x=-8: half way.
    const f: ReplayFrame[] = [
      [0,  -20, 0, 0, 5],
      [200,  4, 0, 0, 5],
    ];
    const times = pacerCheckpointTimes(f, [{ x: 0, z: 0 }]);
    expect(times[0]).not.toBeNull();
    expect(times[0]!).toBeCloseTo(100, 0);
  });

  it("returns monotonically non-decreasing times for checkpoints in lap order", () => {
    const f: ReplayFrame[] = [
      [0,   0,   0, 0, 5],
      [500, 50,  0, 0, 5],
      [1000, 100, 0, 0, 5],
    ];
    const cps = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }];
    const times = pacerCheckpointTimes(f, cps);

    const nonNull = times.filter((t): t is number => t !== null);
    expect(nonNull).toHaveLength(3);
    for (let i = 1; i < nonNull.length; i++) {
      expect(nonNull[i]).toBeGreaterThanOrEqual(nonNull[i - 1]);
    }
  });

  it("scans forward only: a checkpoint reached before the previous one is never found", () => {
    const f: ReplayFrame[] = [
      [0, 0, 0, 0, 5],
      [500, 100, 0, 0, 5],
      [1000, 200, 0, 0, 5],
    ];
    const cps = [{ x: 100, z: 0 }, { x: 0, z: 0 }];
    // Enters radius 8 around x=100 at x=92: 92% of the first segment.
    expect(pacerCheckpointTimes(f, cps)).toEqual([460, null]);
  });

  it("takes the raw frame time when the scan resumes on a frame already inside the next radius", () => {
    // Both checkpoints contain frame 1; the second scan starts there and must
    // not interpolate back from frame 0.
    const f: ReplayFrame[] = [
      [0, -50, 0, 0, 5],
      [500, 0, 0, 0, 5],
    ];
    const cps = [{ x: 0, z: 0 }, { x: 3, z: 0 }];
    expect(pacerCheckpointTimes(f, cps)).toEqual([
      expect.any(Number),
      500,
    ]);
  });
});


describe("pacerDelta", () => {
  const pacerTimes: (number | null)[] = [0, 500, 1000, null];

  it("is negative when the driver is ahead, positive when behind", () => {
    expect(pacerDelta(pacerTimes, 1, 400)).toBe(-100);
    expect(pacerDelta(pacerTimes, 1, 600)).toBe(100);
    expect(pacerDelta(pacerTimes, 1, 500)).toBe(0);
  });

  it("is null when the Pacer never crossed that checkpoint or the index is out of range", () => {
    expect(pacerDelta(pacerTimes, 3, 1000)).toBeNull();
    expect(pacerDelta(pacerTimes, -1, 1000)).toBeNull();
    expect(pacerDelta(pacerTimes, 99, 1000)).toBeNull();
  });
});


function makeCarGroup(): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

function makeScene() {
  return { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;
}

function mockCarMeshAndCanvas(): void {
  vi.mocked(createCarMesh).mockReset();
  vi.mocked(createCarMesh).mockImplementation(() => makeCarGroup());
  // jsdom has no 2D canvas; the REPLAY badge only needs a context that
  // swallows its draw calls.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    beginPath: () => {},
    roundRect: () => {},
    fill: () => {},
    fillText: () => {},
  } as never);
}

describe("PacerOverlay Variant", () => {
  const FRAMES: ReplayFrame[] = [
    [0, 0, 0, 0, 0],
    [1000, 5, 5, 0, 10],
  ];

  // resolveVariant("Ava") is "suv", so a recorded "taxi" genuinely differs
  // from the fallback these tests compare against.
  const DRIVER = "Ava";

  beforeEach(mockCarMeshAndCanvas);

  it("rebuilds the mesh from the recorded Variant when frames arrive", () => {
    const overlay = new PacerOverlay(makeScene(), DRIVER);
    overlay.setFrames(FRAMES, "taxi");
    expect(createCarMesh).toHaveBeenLastCalledWith(DRIVER, undefined, "taxi");
    expect(overlay.resolvedVariant()).toBe("taxi");
  });

  it("an absent recorded Variant falls back to the driver-name hash (legacy laps)", () => {
    const overlay = new PacerOverlay(makeScene(), DRIVER);
    overlay.setFrames(FRAMES);
    expect(overlay.resolvedVariant()).toBe(resolveVariant(DRIVER));
    expect(createCarMesh).toHaveBeenCalledTimes(1);
    expect(createCarMesh).toHaveBeenCalledWith(DRIVER, undefined, resolveVariant(DRIVER));
  });

  it("keeps the Pacer styling on a Variant rebuild: translucency, original colour, no shadows, badge", () => {
    const scene = makeScene();
    const overlay = new PacerOverlay(scene, DRIVER);
    overlay.setFrames(FRAMES, "taxi");
    const added = vi.mocked(scene.add).mock.calls;
    const mesh = added[added.length - 1][0] as THREE.Group;

    let material: THREE.MeshLambertMaterial | null = null;
    let hasBadge = false;
    let castsShadows = false;
    mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        material = obj.material as THREE.MeshLambertMaterial;
        castsShadows = castsShadows || obj.castShadow || obj.receiveShadow;
      } else if (obj instanceof THREE.Sprite) {
        hasBadge = true;
      }
    });

    expect(material).not.toBeNull();
    expect(material!.transparent).toBe(true);
    expect(material!.opacity).toBe(0.35);
    // No tint: the ghost keeps the car's own paint.
    expect(material!.color.getHex()).toBe(0xffffff);
    expect(castsShadows).toBe(false);
    expect(hasBadge).toBe(true);
    expect(overlay.resolvedVariant()).toBe("taxi");
  });

  it("a Variant rebuild removes the previous mesh and disposes its cloned materials", () => {
    const scene = makeScene();
    const overlay = new PacerOverlay(scene, DRIVER);
    const first = vi.mocked(scene.add).mock.calls[0][0] as THREE.Group;
    let disposed = false;
    first.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material).dispose = () => {
          disposed = true;
        };
      }
    });

    overlay.setFrames(FRAMES, "taxi");
    expect(scene.remove).toHaveBeenCalledWith(first);
    expect(disposed).toBe(true);
  });

  it("re-arming with the unchanged Variant does not rebuild the mesh", () => {
    const overlay = new PacerOverlay(makeScene(), DRIVER);
    overlay.setFrames(FRAMES, "taxi");
    overlay.setFrames(FRAMES, "taxi");
    expect(createCarMesh).toHaveBeenCalledTimes(2);
  });
});

describe("PacerOverlay.state", () => {
  beforeEach(mockCarMeshAndCanvas);

  function createOverlay(): PacerOverlay {
    return new PacerOverlay(makeScene(), "Ava");
  }

  it("reports no frames, not playing, and hidden before frames arrive", () => {
    expect(createOverlay().state()).toMatchObject({
      frameCount: 0,
      playing: false,
      visible: false,
    });
  });

  it("reports the loaded frame count while still hidden (pre start-line)", () => {
    const overlay = createOverlay();
    overlay.setFrames(frames);
    expect(overlay.state()).toMatchObject({ frameCount: 3, playing: false, visible: false });
  });

  it("reports playing and visible once restarted and updated mid-recording", () => {
    const overlay = createOverlay();
    overlay.setFrames(frames);
    overlay.restart(1000);
    overlay.update(1100, 1 / 60);
    expect(overlay.state()).toMatchObject({ playing: true, visible: true });
  });

  it("reports a translucent car: opacity strictly between 0 and 1", () => {
    const { opacity } = createOverlay().state();
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it("reports not playing and hidden again after a Respawn", () => {
    const overlay = createOverlay();
    overlay.setFrames(frames);
    overlay.restart(1000);
    overlay.update(1100, 1 / 60);
    overlay.onRespawn();
    expect(overlay.state()).toMatchObject({ playing: false, visible: false });
  });
});
