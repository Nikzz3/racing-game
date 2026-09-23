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

describe("RemotePlayers obstacles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers each remote car's drawn pose and speed to collide with, never the local player's", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "m");
    rp.onSnapshot([
      { ...makeSnapshot("m"), x: 99, z: 99 },
      { ...makeSnapshot("a"), x: 0, z: 0, rot: 0, speed: 10 },
      { ...makeSnapshot("z"), x: 5, z: 5 },
    ]);
    now = 100;
    rp.onSnapshot([
      { ...makeSnapshot("a"), x: 0, z: 10, rot: 0.5, speed: 30 },
      { ...makeSnapshot("z"), x: 5, z: 5 },
    ]);
    now = 180; // render time is halfway between the two snapshots
    rp.update(1 / 60);
    const [a, z] = rp.obstacles();
    expect(a).toMatchObject({ x: 0, heading: 0.25, speed: 20 });
    expect(a.z).toBeCloseTo(5);
    // Opposite players break an exact overlap towards opposite sides.
    expect(a.side).toBe(1);
    expect(z.side).toBe(-1);
  });

  it("passes through a remote car that teleports, respawns or has only just appeared", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "m", 90);
    const drawn = () => rp.obstacles().map(({ x, z }) => `${x},${z}`);
    rp.onSnapshot([{ ...makeSnapshot("a"), x: 0, z: 0 }]);
    now = 50;
    rp.onSnapshot([
      { ...makeSnapshot("a"), x: 0, z: 0 },
      { ...makeSnapshot("joiner"), x: 0, z: 0 },
    ]);
    now = 180;
    rp.update(1 / 60);
    // The joiner has one snapshot, so no motion to judge yet.
    expect(drawn()).toEqual(["0,0"]);

    // 10 m in 50 ms is within 2.5 × 90 m/s; 200 m is a forged hop.
    now = 100;
    rp.onSnapshot([
      { ...makeSnapshot("a"), x: 10, z: 0 },
      { ...makeSnapshot("joiner"), x: 200, z: 0 },
    ]);
    now = 230;
    rp.update(1 / 60);
    expect(drawn()).toEqual(["10,0"]);

    now = 150;
    rp.onSnapshot([
      { ...makeSnapshot("a"), x: 11, z: 0, spawns: 1 },
      { ...makeSnapshot("joiner"), x: 201, z: 0 },
    ]);
    now = 280;
    rp.update(1 / 60);
    expect(drawn()).toEqual(["201,0"]);
  });
});

describe("RemotePlayers with Direct Links", () => {
  // The sender's clock runs 5 s ahead of ours; it sends pose n at 50n ms of our
  // time, which the relay delivers 60 ms later and a Direct Link 10 ms later.
  const SENDER_CLOCK = 5000;
  const sentAt = (seq: number) => SENDER_CLOCK + seq * 50;
  const stamped = (seq: number, overrides: Partial<ReturnType<typeof makeSnapshot>> = {}) => ({
    ...makeSnapshot("p1"),
    x: seq * 10,
    speed: 20,
    stamp: { seq, sentAt: sentAt(seq), epoch: 0 },
    direct: true as const,
    ...overrides,
  });
  const direct = (seq: number, x = seq * 10) => ({
    stamp: { seq, sentAt: sentAt(seq), epoch: 0 },
    x,
    z: 0,
    rot: 0,
    speed: 20,
  });

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

  it("draws a directly linked car by its sender's clock, with less delay than the relay", () => {
    now = 60;
    remote.onSnapshot([stamped(1)]);
    for (const seq of [2, 3, 4]) {
      now = seq * 50 + 10;
      remote.onDirectPose("p1", direct(seq));
      now = seq * 50 + 60;
      remote.onSnapshot([stamped(seq)]);
    }
    now = 210;
    remote.update(1 / 60);
    expect(remote.sources()).toEqual({ p1: "direct" });
    expect(remote.directPoses()).toEqual({ p1: 3 });
    // Drawn 80 ms behind the fastest path: sender time 5120, 40% from pose 2 to 3.
    expect(mesh.position.x).toBeCloseTo(24);
    expect(remote.obstacles()).toHaveLength(1);
  });

  it("keeps drawing relayed poses when the Direct Link falls silent", () => {
    now = 60;
    remote.onSnapshot([stamped(1)]);
    now = 110;
    remote.onDirectPose("p1", direct(2));
    for (let seq = 2; seq <= 12; seq++) {
      now = seq * 50 + 60;
      remote.onSnapshot([stamped(seq)]);
    }
    expect(remote.sources()).toEqual({ p1: "relay" });
    now = 660;
    remote.update(1 / 60);
    expect(mesh.position.x).toBeGreaterThan(80);
    expect(mesh.position.x).toBeLessThanOrEqual(120);
  });

  it("stops trusting a Direct Link whose copy of a pose differs from the relayed one", () => {
    now = 60;
    remote.onSnapshot([stamped(1)]);
    now = 110;
    remote.onDirectPose("p1", direct(2, 500));
    now = 160;
    remote.onSnapshot([stamped(2)]);
    expect(remote.sources()).toEqual({ p1: "relay" });
    // Later Direct Link poses are ignored and the forged one is gone.
    now = 160;
    remote.onDirectPose("p1", direct(3, 900));
    // Render time lands exactly on the relayed pose 2.
    now = 240;
    remote.update(1 / 60);
    expect(mesh.position.x).toBe(20);
  });

  it("ignores Direct Link poses before the relay has placed the car, or far ahead of it", () => {
    now = 10;
    remote.onDirectPose("p1", direct(1));
    remote.onDirectPose("ghost", direct(1));
    expect(remote.positions()).toEqual([]);
    now = 60;
    remote.onSnapshot([stamped(1)]);
    remote.onDirectPose("p1", direct(100));
    expect(remote.sources()).toEqual({ p1: "relay" });
  });

  it("counts a Direct Link as live on a slow client whose poses arrive in bunches", () => {
    // A page drawing ~2 frames a second sends and receives in bursts, seconds apart.
    now = 60;
    remote.onSnapshot([stamped(1)]);
    for (const seq of [2, 3, 4]) {
      now = 1000 * seq;
      remote.onDirectPose("p1", direct(seq));
      now += 400;
      remote.onSnapshot([stamped(seq)]);
      now += 400;
      expect(remote.sources()).toEqual({ p1: "direct" });
    }
  });

  it("draws from the relay when it, not the Direct Link, delivers poses first", () => {
    now = 60;
    remote.onSnapshot([stamped(1)]);
    for (const seq of [2, 3, 4, 5]) {
      now = seq * 50 + 20;
      remote.onSnapshot([stamped(seq)]);
      now = seq * 50 + 40;
      remote.onDirectPose("p1", direct(seq));
    }
    expect(remote.sources()).toEqual({ p1: "relay" });
    expect(remote.directPoses()).toEqual({ p1: 0 });
  });

  it("starts over once a driver's relayed poses gain stamps", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 0 }]);
    now = 60;
    remote.onSnapshot([stamped(1)]);
    now = 110;
    remote.onSnapshot([stamped(2)]);
    now = 240;
    remote.update(1 / 60);
    // Only the stamped poses remain, and render time lands on the newest.
    expect(mesh.position.x).toBe(20);
    expect(remote.obstacles()).toHaveLength(1);
  });
});
