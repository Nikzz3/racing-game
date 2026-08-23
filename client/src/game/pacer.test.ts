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

// ---------------------------------------------------------------------------
// pacerCheckpointTimes
// ---------------------------------------------------------------------------

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
    // First frame is already at the checkpoint center (dist = 0 < radius).
    // No prior frame to interpolate from, so the function returns that frame's time.
    const f: ReplayFrame[] = [
      [0,   0, 0, 0, 5],
      [100, 20, 0, 0, 5],
    ];
    const times = pacerCheckpointTimes(f, [{ x: 0, z: 0 }]);
    expect(times[0]).toBe(0);
  });

  it("interpolates the entry time when the Pacer crosses the radius boundary between frames", () => {
    // Pacer moves from (−20, 0) to (4, 0) over 200 ms.
    // Checkpoint at (0, 0), default radius 8.
    // Exact crossing (via quadratic): fraction = 0.5 → time = 100 ms.
    const f: ReplayFrame[] = [
      [0,  -20, 0, 0, 5],
      [200,  4, 0, 0, 5],
    ];
    const times = pacerCheckpointTimes(f, [{ x: 0, z: 0 }]);
    expect(times[0]).not.toBeNull();
    expect(times[0]!).toBeCloseTo(100, 0);
  });

  it("returns monotonically non-decreasing times for checkpoints in lap order", () => {
    // Pacer passes through each checkpoint exactly (dist = 0 < radius).
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

  it("uses only frames starting from the previous checkpoint (scan is forward-only)", () => {
    // Two checkpoints: both at the same x=0 position but in scan order.
    // We want to ensure the second checkpoint scan starts after the first found frame,
    // producing a later time. Here CP0 is at x=0 (frame 0) and CP1 also at x=0
    // but would only be re-scanned from frame 0 onward; we make CP1 far away so null.
    const f: ReplayFrame[] = [
      [0,  0, 0, 0, 5],
      [500, 100, 0, 0, 5],
    ];
    const cps = [{ x: 0, z: 0 }, { x: 300, z: 0 }]; // CP1 far out of reach
    const times = pacerCheckpointTimes(f, cps);
    expect(times[0]).not.toBeNull();
    expect(times[1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pacerDelta
// ---------------------------------------------------------------------------

describe("pacerDelta", () => {
  const pacerTimes: (number | null)[] = [0, 500, 1000, null];

  it("returns negative when driver arrives before the Pacer (driver ahead)", () => {
    // Driver at CP1 in 400 ms, Pacer crossed it at 500 ms. Delta = 400 − 500 = −100.
    expect(pacerDelta(pacerTimes, 1, 400)).toBe(-100);
  });

  it("returns positive when driver arrives after the Pacer (driver behind)", () => {
    // Driver at CP1 in 600 ms, Pacer crossed it at 500 ms. Delta = 600 − 500 = 100.
    expect(pacerDelta(pacerTimes, 1, 600)).toBe(100);
  });

  it("returns zero when driver and Pacer cross at the same time", () => {
    expect(pacerDelta(pacerTimes, 1, 500)).toBe(0);
  });

  it("returns null when the Pacer never crossed that checkpoint", () => {
    expect(pacerDelta(pacerTimes, 3, 1000)).toBeNull();
  });

  it("returns null for a negative checkpoint index", () => {
    expect(pacerDelta(pacerTimes, -1, 1000)).toBeNull();
  });

  it("returns null for an out-of-range checkpoint index", () => {
    expect(pacerDelta(pacerTimes, 99, 1000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PacerOverlay Variant (#127)
// ---------------------------------------------------------------------------

describe("PacerOverlay Variant", () => {
  const FRAMES: ReplayFrame[] = [
    [0, 0, 0, 0, 0],
    [1000, 5, 5, 0, 10],
  ];

  // resolveVariant("Ava") is "suv", so a recorded "taxi" genuinely differs
  // from the fallback these tests compare against.
  const DRIVER = "Ava";

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

  beforeEach(() => {
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
  });

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
    // The constructor's mesh already renders the fallback; no rebuild happens.
    expect(createCarMesh).toHaveBeenCalledTimes(1);
    expect(createCarMesh).toHaveBeenCalledWith(DRIVER, undefined, resolveVariant(DRIVER));
  });

  it("keeps the Pacer styling on a Variant rebuild: tint, translucency, no shadows, badge", () => {
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
    expect(material!.opacity).toBe(0.5);
    expect(material!.color.getHex()).toBe(0x00e5ff);
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
    // Constructor + the one taxi rebuild.
    expect(createCarMesh).toHaveBeenCalledTimes(2);
  });
});
