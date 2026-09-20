import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";

vi.mock("./car", async (importOriginal) => {
  const original = await importOriginal<typeof import("./car")>();
  return { ...original, createCarMesh: vi.fn(), animateCar: vi.fn() };
});

import type { Variant } from "@racing/shared";
import { createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import { RemotePlayers } from "./remote";

function makeSnapshot(id: string, name = "Player", variant?: Variant) {
  return {
    id,
    name,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    speed: 0,
    laps: 0,
    lastLapMs: null,
    bestLapMs: null,
    lapStartT: null,
    nextCheckpoint: 0,
    spawns: 0,
    variant,
  };
}

function makeMeshWithSprite(): {
  mesh: THREE.Group;
  disposeTexture: ReturnType<typeof vi.fn>;
  disposeMaterial: ReturnType<typeof vi.fn>;
} {
  const disposeTexture = vi.fn();
  const disposeMaterial = vi.fn();
  const mesh = new THREE.Group();
  const mat = new THREE.SpriteMaterial();
  mat.map = { dispose: disposeTexture } as unknown as THREE.Texture;
  mat.dispose = disposeMaterial;
  const sprite = new THREE.Sprite(mat);
  mesh.add(sprite);
  return { mesh, disposeTexture, disposeMaterial };
}

function makeMockScene() {
  return { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;
}

describe("RemotePlayers movement", () => {
  let now: number;
  let mesh: THREE.Group;
  let remote: RemotePlayers;

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mesh = new THREE.Group();
    vi.mocked(createCarMesh).mockReset().mockReturnValue(mesh);
    remote = new RemotePlayers(makeMockScene(), "me");
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([100, 5])(
    "teleports a respawning car from %i m out without sweeping or overshooting",
    (x) => {
      remote.onSnapshot([{ ...makeSnapshot("p1"), x, speed: 50 }]);
      now = 100;
      remote.onSnapshot([{ ...makeSnapshot("p1"), spawns: 1 }]);

      // Rendering is delayed by 130 ms; retain the old pose until the respawn.
      now = 180;
      remote.update(1 / 60);
      expect(mesh.position.x).toBe(x);
      now = 240;
      remote.update(1 / 60);
      expect(mesh.position.x).toBe(0);
      now = 300;
      remote.update(1 / 60);
      expect(mesh.position.x).toBe(0);
    },
  );

  it("still interpolates ordinary high-speed movement", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), speed: 110 }]);
    now = 100;
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 11, speed: 110 }]);
    now = 180;
    remote.update(1 / 60);
    expect(mesh.position.x).toBeCloseTo(5.5);
  });

  it("interpolates a long jump that is not a respawn, such as stall catch-up", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), speed: 100 }]);
    now = 50;
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 60, speed: 100 }]);
    now = 155;
    remote.update(1 / 60);
    expect(mesh.position.x).toBeCloseTo(30);
  });
});

describe("disposeCarMesh", () => {
  it("disposes the sprite material and texture", () => {
    const { mesh, disposeTexture, disposeMaterial } = makeMeshWithSprite();
    disposeCarMesh(mesh);
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });

  it("does nothing on a group with no sprites", () => {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    expect(() => disposeCarMesh(mesh)).not.toThrow();
  });

  it("skips sprites with no texture map", () => {
    const mesh = new THREE.Group();
    const mat = new THREE.SpriteMaterial();
    const disposeMaterial = vi.fn();
    mat.dispose = disposeMaterial;
    mesh.add(new THREE.Sprite(mat));
    disposeCarMesh(mesh);
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});

describe("RemotePlayers name-tag disposal", () => {
  let scene: THREE.Scene;
  let rp: RemotePlayers;

  beforeEach(() => {
    scene = makeMockScene();
    rp = new RemotePlayers(scene, "me");
    vi.mocked(createCarMesh).mockReset();
  });

  it("disposes texture and material when a player leaves via onSnapshot", () => {
    const { mesh, disposeTexture, disposeMaterial } = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(mesh);

    rp.onSnapshot([makeSnapshot("p1")]);
    expect(createCarMesh).toHaveBeenCalledOnce();
    rp.onSnapshot([]);

    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });

  it("disposes all meshes' textures and materials on dispose()", () => {
    const a = makeMeshWithSprite();
    const b = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(a.mesh).mockReturnValueOnce(b.mesh);

    rp.onSnapshot([makeSnapshot("p1"), makeSnapshot("p2")]);
    rp.dispose();

    expect(a.disposeMaterial).toHaveBeenCalledOnce();
    expect(a.disposeTexture).toHaveBeenCalledOnce();
    expect(b.disposeMaterial).toHaveBeenCalledOnce();
    expect(b.disposeTexture).toHaveBeenCalledOnce();
  });

  it("does not double-dispose when a player leaves then dispose() is called", () => {
    const { mesh, disposeTexture, disposeMaterial } = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(mesh);

    rp.onSnapshot([makeSnapshot("p1")]);
    rp.onSnapshot([]);
    rp.dispose();

    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });
});

describe("RemotePlayers variants", () => {
  let scene: THREE.Scene;
  let rp: RemotePlayers;

  beforeEach(() => {
    scene = makeMockScene();
    rp = new RemotePlayers(scene, "me");
    vi.mocked(createCarMesh).mockReset();
    vi.mocked(createCarMesh).mockImplementation(() => new THREE.Group());
  });

  it("builds the remote mesh with the snapshot's variant", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")]);
    expect(createCarMesh).toHaveBeenCalledWith("p1", "Player", "taxi");
    expect(rp.resolvedVariants()).toEqual({ p1: "taxi" });
  });

  it("swaps the mesh when a later snapshot changes the variant", () => {
    const first = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(first.mesh);

    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")]);
    rp.onSnapshot([makeSnapshot("p1", "Player", "van")]);

    expect(createCarMesh).toHaveBeenCalledTimes(2);
    expect(createCarMesh).toHaveBeenLastCalledWith("p1", "Player", "van");
    expect(first.disposeMaterial).toHaveBeenCalledOnce();
    expect(scene.remove).toHaveBeenCalledWith(first.mesh);
    expect(rp.resolvedVariants()).toEqual({ p1: "van" });
  });

  it("keeps the mesh when repeat snapshots carry the same variant", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")]);
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")]);
    expect(createCarMesh).toHaveBeenCalledOnce();
  });

  it("rebuilds a changed name and releases the old name tag", () => {
    const first = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(first.mesh);
    rp.onSnapshot([makeSnapshot("p1", "Before", "taxi")]);
    rp.onSnapshot([makeSnapshot("p1", "After", "taxi")]);
    expect(createCarMesh).toHaveBeenLastCalledWith("p1", "After", "taxi");
    expect(first.disposeTexture).toHaveBeenCalledOnce();
    expect(first.disposeMaterial).toHaveBeenCalledOnce();
  });

  it("resolves an absent variant to the stable hash fallback, without churn", () => {
    rp.onSnapshot([makeSnapshot("p1")]);
    rp.onSnapshot([makeSnapshot("p1")]);
    expect(createCarMesh).toHaveBeenCalledOnce();
    expect(rp.resolvedVariants()).toEqual({ p1: resolveVariant("p1") });
  });

  it("swaps back to the hash fallback when a variant goes absent", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")]);
    rp.onSnapshot([makeSnapshot("p1")]);
    expect(createCarMesh).toHaveBeenCalledTimes(2);
    expect(rp.resolvedVariants()).toEqual({ p1: resolveVariant("p1") });
  });

  it("forgets a player's variant when they leave", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")]);
    rp.onSnapshot([]);
    expect(rp.resolvedVariants()).toEqual({});
  });
});

describe("RemotePlayers positions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports each remote car where its mesh is drawn, and forgets leavers", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "me");
    rp.onSnapshot([
      { ...makeSnapshot("me"), x: 99, z: 99 },
      { ...makeSnapshot("p1"), x: 10, z: -20 },
      { ...makeSnapshot("p2"), x: 30, z: 40 },
    ]);
    expect(rp.positions()).toEqual([
      { id: "p1", x: 10, z: -20 },
      { id: "p2", x: 30, z: 40 },
    ]);
    now = 100;
    rp.onSnapshot([{ ...makeSnapshot("p2"), x: 31, z: 41 }]);
    now = 230; // render time lands exactly on the newest snapshot
    rp.update(1 / 60);
    expect(rp.positions()).toEqual([{ id: "p2", x: 31, z: 41 }]);
  });
});
