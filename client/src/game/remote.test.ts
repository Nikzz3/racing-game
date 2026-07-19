import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

vi.mock("./car", async (importOriginal) => {
  const original = await importOriginal<typeof import("./car")>();
  return { ...original, createCarMesh: vi.fn(), animateCar: vi.fn() };
});

import { createCarMesh, disposeCarMesh } from "./car";
import { RemotePlayers } from "./remote";

function makeSnapshot(id: string, name = "Player") {
  return {
    id, name, x: 0, y: 0, z: 0, rot: 0, speed: 0,
    laps: 0, lastLapMs: null, bestLapMs: null, lapStartT: null, nextCheckpoint: 0,
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
  (mat as any).map = { dispose: disposeTexture };
  mat.dispose = disposeMaterial;
  const sprite = new THREE.Sprite(mat);
  mesh.add(sprite);
  return { mesh, disposeTexture, disposeMaterial };
}

function makeMockScene() {
  return { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;
}

// ── disposeCarMesh unit tests ────────────────────────────────────────────────

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
    // should not throw
    expect(() => disposeCarMesh(mesh)).not.toThrow();
  });

  it("skips sprites with no texture map", () => {
    const mesh = new THREE.Group();
    const mat = new THREE.SpriteMaterial();
    const disposeMaterial = vi.fn();
    mat.dispose = disposeMaterial;
    // mat.map is null by default
    mesh.add(new THREE.Sprite(mat));
    disposeCarMesh(mesh);
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});

// ── RemotePlayers disposal tests ─────────────────────────────────────────────

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

    // Player joins
    rp.onSnapshot([makeSnapshot("p1")]);
    expect(vi.mocked(createCarMesh)).toHaveBeenCalledOnce();

    // Player leaves (empty snapshot)
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
    rp.onSnapshot([]); // p1 leaves → disposed once
    rp.dispose();      // nothing left to dispose

    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });
});
