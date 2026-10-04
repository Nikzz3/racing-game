import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

vi.mock("./car", async (importOriginal) => {
  const original = await importOriginal<typeof import("./car")>();
  return { ...original, createCarMesh: vi.fn(), animateCar: vi.fn() };
});

import type { PlayerSnapshot, Variant } from "@racing/shared";
import { createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import { DIRECT_INTERPOLATION_DELAY_MS, INTERPOLATION_DELAY_MS, RemotePlayers } from "./remote";
import { ServerClock } from "./server-clock";

/** Draw the cars as they were at server time `t`. */
function drawAt(remote: RemotePlayers, t: number): void {
  remote.update(1 / 60, t + INTERPOLATION_DELAY_MS);
}

/** Deterministic noise in [0, 1). */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function makeSnapshot(id: string, name = "Player", variant?: Variant): PlayerSnapshot {
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
  let mesh: THREE.Group;
  let remote: RemotePlayers;

  beforeEach(() => {
    mesh = new THREE.Group();
    vi.mocked(createCarMesh).mockReset().mockReturnValue(mesh);
    remote = new RemotePlayers(makeMockScene(), "me");
  });

  it.each([100, 5])(
    "teleports a respawning car from %i m out without sweeping or overshooting",
    (x) => {
      remote.onSnapshot([{ ...makeSnapshot("p1"), x, speed: 50 }], 0);
      remote.onSnapshot([{ ...makeSnapshot("p1"), spawns: 1 }], 100);

      // Retain the old pose until the respawn is due, then sit on the spawn.
      drawAt(remote, 50);
      expect(mesh.position.x).toBe(x);
      drawAt(remote, 110);
      expect(mesh.position.x).toBe(0);
      drawAt(remote, 170);
      expect(mesh.position.x).toBe(0);
    },
  );

  it("still interpolates ordinary high-speed movement", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), speed: 110 }], 0);
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 11, speed: 110 }], 100);
    drawAt(remote, 50);
    expect(mesh.position.x).toBeCloseTo(5.5);
  });

  it("interpolates a long jump that is not a respawn, such as stall catch-up", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), speed: 100 }], 0);
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 60, speed: 100 }], 50);
    drawAt(remote, 25);
    expect(mesh.position.x).toBeCloseTo(30);
  });

  it("extrapolates briefly past the newest state, then holds", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), speed: 100 }], 0);
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 5, speed: 100 }], 50);
    drawAt(remote, 60);
    expect(mesh.position.x).toBeCloseTo(6);
    drawAt(remote, 500);
    expect(mesh.position.x).toBeCloseTo(6.25);
  });

  it("places each car by when its state was current, not by the snapshot carrying it", () => {
    remote.onSnapshot([{ ...makeSnapshot("p1"), t: 10 }], 50);
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 5, t: 60 }], 100);
    drawAt(remote, 35);
    expect(mesh.position.x).toBeCloseTo(2.5);
  });

  it("does not stall a car when a snapshot repeats its state", () => {
    // The tick at 100 found no new state; the one at 150 carries two sends' travel.
    remote.onSnapshot([{ ...makeSnapshot("p1"), t: 10 }], 50);
    remote.onSnapshot([{ ...makeSnapshot("p1"), t: 10 }], 100);
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 10, t: 110 }], 150);
    const drawn = [35, 60, 85].map((t) => {
      drawAt(remote, t);
      return mesh.position.x;
    });
    expect(drawn[0]).toBeCloseTo(2.5);
    expect(drawn[1]).toBeCloseTo(5);
    expect(drawn[2]).toBeCloseTo(7.5);
  });

  it("drops the broadcast time a joiner stood in on once its own state times arrive", () => {
    // Before its first state a player sits at the origin, stamped with the snapshot's time.
    remote.onSnapshot([makeSnapshot("p1")], 100);
    remote.onSnapshot([{ ...makeSnapshot("p1"), x: 40, t: 80 }], 150);
    drawAt(remote, 200);
    expect(mesh.position.x).toBe(40);
    expect(remote.obstacles()).toEqual([]);
  });

  it("keeps a car's motion when a new name or Variant rebuilds it", () => {
    const rebuilt = new THREE.Group();
    vi.mocked(createCarMesh).mockReturnValueOnce(mesh).mockReturnValueOnce(rebuilt);
    remote.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    remote.onSnapshot([{ ...makeSnapshot("p1", "Player", "van"), x: 10 }], 100);
    drawAt(remote, 50);
    expect(rebuilt.position.x).toBeCloseTo(5);
    expect(remote.obstacles()).toHaveLength(1);
  });
});

describe("RemotePlayers under network jitter", () => {
  const SPEED = 60;
  const FRAME_MS = 1000 / 60;

  /**
   * One remote car driving at a constant SPEED, relayed as in a Room. Its client
   * samples a pose every 60 Hz frame and sends the latest on a 15.6 ms-grained
   * Windows timer (46.8 or 62.4 ms apart), so against the server's own 50 ms
   * broadcast tick some snapshots repeat a state and the next carries two sends'
   * travel. Snapshots then cross a jittery network, and a receiver busy in a
   * frame (some of them long) handles them only at the next. Returns the drawn
   * speed on each receiver frame after the first second.
   */
  function drawnSpeeds(stamped: boolean, seed = 1): number[] {
    const random = noise(seed);
    const mesh = new THREE.Group();
    vi.mocked(createCarMesh).mockReset().mockReturnValue(mesh);
    const remote = new RemotePlayers(makeMockScene(), "me");
    const clock = new ServerClock();
    // The receiver's clock is unrelated to the server's.
    const LOCAL_OFFSET = -1_000_000;

    // States as the server stores them: arrival, and the sender's pose time mapped by the offset.
    const states: { arrival: number; t: number; x: number }[] = [];
    for (let sent = 0; sent < 10_000; sent += random() < 0.5 ? 46.8 : 62.4) {
      const pose = Math.floor(sent / FRAME_MS) * FRAME_MS;
      states.push({ arrival: sent + 5 + random() * 20, t: pose + 5, x: (SPEED * pose) / 1000 });
    }
    const snapshots: { tick: number; delivered: number; state: (typeof states)[number] }[] = [];
    let latest = -1;
    let delivered = 0;
    for (let tick = 50; tick < 10_000; tick += 50) {
      while (latest + 1 < states.length && states[latest + 1].arrival <= tick) latest++;
      if (latest < 0) continue;
      // One TCP stream: snapshots arrive in order.
      delivered = Math.max(delivered, tick + 10 + random() * 30);
      snapshots.push({ tick, delivered, state: states[latest] });
    }

    const speeds: number[] = [];
    let next = 0;
    let previous: { frame: number; x: number } | null = null;
    for (let frame = 0; frame < 9_000; frame += random() < 0.05 ? 40 : FRAME_MS) {
      for (; next < snapshots.length && snapshots[next].delivered <= frame; next++) {
        const { tick, state } = snapshots[next];
        clock.observe(tick, frame + LOCAL_OFFSET);
        const t = stamped ? state.t : undefined;
        remote.onSnapshot([{ ...makeSnapshot("p1"), x: state.x, speed: SPEED, t }], tick);
      }
      remote.update(1 / 60, clock.now(frame + LOCAL_OFFSET));
      if (previous && frame >= 1_000) {
        speeds.push(((mesh.position.x - previous.x) / (frame - previous.frame)) * 1000);
      }
      previous = { frame, x: mesh.position.x };
    }
    return speeds;
  }

  const worst = (speeds: number[]) => Math.max(...speeds.map((v) => Math.abs(v / SPEED - 1)));

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "draws a car at constant speed from its sender's state times (run %i)",
    (seed) => {
      // The clock's own corrections are bounded at 5%, far below what the eye catches.
      expect(worst(drawnSpeeds(true, seed))).toBeLessThan(0.06);
    },
  );

  it("falls back to the broadcast time for states without their own, as older servers send", () => {
    const speeds = drawnSpeeds(false);
    const mean = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;
    expect(mean).toBeCloseTo(SPEED, 0);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0);
    // The repeats this relay produces are what per-player state times remove.
    expect(worst(speeds)).toBeGreaterThan(0.5);
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

    rp.onSnapshot([makeSnapshot("p1")], 0);
    expect(createCarMesh).toHaveBeenCalledOnce();
    rp.onSnapshot([], 0);

    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });

  it("disposes all meshes' textures and materials on dispose()", () => {
    const a = makeMeshWithSprite();
    const b = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(a.mesh).mockReturnValueOnce(b.mesh);

    rp.onSnapshot([makeSnapshot("p1"), makeSnapshot("p2")], 0);
    rp.dispose();

    expect(a.disposeMaterial).toHaveBeenCalledOnce();
    expect(a.disposeTexture).toHaveBeenCalledOnce();
    expect(b.disposeMaterial).toHaveBeenCalledOnce();
    expect(b.disposeTexture).toHaveBeenCalledOnce();
  });

  it("does not double-dispose when a player leaves then dispose() is called", () => {
    const { mesh, disposeTexture, disposeMaterial } = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(mesh);

    rp.onSnapshot([makeSnapshot("p1")], 0);
    rp.onSnapshot([], 0);
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
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    expect(createCarMesh).toHaveBeenCalledWith("p1", "Player", "taxi");
    expect(rp.resolvedVariants()).toEqual({ p1: "taxi" });
  });

  it("swaps the mesh when a later snapshot changes the variant", () => {
    const first = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(first.mesh);

    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    rp.onSnapshot([makeSnapshot("p1", "Player", "van")], 0);

    expect(createCarMesh).toHaveBeenCalledTimes(2);
    expect(createCarMesh).toHaveBeenLastCalledWith("p1", "Player", "van");
    expect(first.disposeMaterial).toHaveBeenCalledOnce();
    expect(scene.remove).toHaveBeenCalledWith(first.mesh);
    expect(rp.resolvedVariants()).toEqual({ p1: "van" });
  });

  it("keeps the mesh when repeat snapshots carry the same variant", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    expect(createCarMesh).toHaveBeenCalledOnce();
  });

  it("rebuilds a changed name and releases the old name tag", () => {
    const first = makeMeshWithSprite();
    vi.mocked(createCarMesh).mockReturnValueOnce(first.mesh);
    rp.onSnapshot([makeSnapshot("p1", "Before", "taxi")], 0);
    rp.onSnapshot([makeSnapshot("p1", "After", "taxi")], 0);
    expect(createCarMesh).toHaveBeenLastCalledWith("p1", "After", "taxi");
    expect(first.disposeTexture).toHaveBeenCalledOnce();
    expect(first.disposeMaterial).toHaveBeenCalledOnce();
  });

  it("resolves an absent variant to the stable hash fallback, without churn", () => {
    rp.onSnapshot([makeSnapshot("p1")], 0);
    rp.onSnapshot([makeSnapshot("p1")], 0);
    expect(createCarMesh).toHaveBeenCalledOnce();
    expect(rp.resolvedVariants()).toEqual({ p1: resolveVariant("p1") });
  });

  it("swaps back to the hash fallback when a variant goes absent", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    rp.onSnapshot([makeSnapshot("p1")], 0);
    expect(createCarMesh).toHaveBeenCalledTimes(2);
    expect(rp.resolvedVariants()).toEqual({ p1: resolveVariant("p1") });
  });

  it("forgets a player's variant when they leave", () => {
    rp.onSnapshot([makeSnapshot("p1", "Player", "taxi")], 0);
    rp.onSnapshot([], 0);
    expect(rp.resolvedVariants()).toEqual({});
  });
});

describe("RemotePlayers positions", () => {
  it("reports each remote car where its mesh is drawn, and forgets leavers", () => {
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "me");
    rp.onSnapshot(
      [
        { ...makeSnapshot("me"), x: 99, z: 99 },
        { ...makeSnapshot("p1"), x: 10, z: -20 },
        { ...makeSnapshot("p2"), x: 30, z: 40 },
      ],
      0,
    );
    expect(rp.positions()).toEqual([
      { id: "p1", x: 10, z: -20 },
      { id: "p2", x: 30, z: 40 },
    ]);
    rp.onSnapshot([{ ...makeSnapshot("p2"), x: 31, z: 41 }], 100);
    drawAt(rp, 100); // render time lands exactly on the newest state
    expect(rp.positions()).toEqual([{ id: "p2", x: 31, z: 41 }]);
  });
});

describe("RemotePlayers obstacles", () => {
  it("offers each remote car's drawn pose and speed to collide with, never the local player's", () => {
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "m");
    rp.onSnapshot(
      [
        { ...makeSnapshot("m"), x: 99, z: 99 },
        { ...makeSnapshot("a"), x: 0, z: 0, rot: 0, speed: 10 },
        { ...makeSnapshot("z"), x: 5, z: 5 },
      ],
      0,
    );
    rp.onSnapshot(
      [
        { ...makeSnapshot("a"), x: 0, z: 10, rot: 0.5, speed: 30 },
        { ...makeSnapshot("z"), x: 5, z: 5 },
      ],
      100,
    );
    drawAt(rp, 50); // halfway between the two states
    const [a, z] = rp.obstacles();
    expect(a).toMatchObject({ x: 0, heading: 0.25, speed: 20 });
    expect(a.z).toBeCloseTo(5);
    // Opposite players break an exact overlap towards opposite sides.
    expect(a.side).toBe(1);
    expect(z.side).toBe(-1);
  });

  it("passes through a remote car that teleports, respawns or has only just appeared", () => {
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "m", 90);
    const drawn = () => rp.obstacles().map(({ x, z }) => `${x},${z}`);
    rp.onSnapshot([{ ...makeSnapshot("a"), x: 0, z: 0 }], 0);
    rp.onSnapshot(
      [
        { ...makeSnapshot("a"), x: 0, z: 0 },
        { ...makeSnapshot("joiner"), x: 0, z: 0 },
      ],
      50,
    );
    drawAt(rp, 50);
    // The joiner has one state, so no motion to judge yet.
    expect(drawn()).toEqual(["0,0"]);

    // 10 m in 50 ms is within 2.5 × 90 m/s; 200 m is a forged hop.
    rp.onSnapshot(
      [
        { ...makeSnapshot("a"), x: 10, z: 0 },
        { ...makeSnapshot("joiner"), x: 200, z: 0 },
      ],
      100,
    );
    drawAt(rp, 100);
    expect(drawn()).toEqual(["10,0"]);

    rp.onSnapshot(
      [
        { ...makeSnapshot("a"), x: 11, z: 0, spawns: 1 },
        { ...makeSnapshot("joiner"), x: 201, z: 0 },
      ],
      150,
    );
    drawAt(rp, 150);
    expect(drawn()).toEqual(["201,0"]);
  });

  it("judges a car's motion over the time between its own states", () => {
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "m", 90);
    // 20 m in two ticks is a car's motion, though only one snapshot apart:
    // the tick in between repeated the older state.
    rp.onSnapshot([{ ...makeSnapshot("a"), t: 0 }], 50);
    rp.onSnapshot([{ ...makeSnapshot("a"), t: 0 }], 100);
    rp.onSnapshot([{ ...makeSnapshot("a"), x: 20, t: 100 }], 150);
    drawAt(rp, 50);
    expect(rp.obstacles()).toHaveLength(1);
  });

  it("passes through a hop whose sender stretched its state times beyond what the server saw elapse", () => {
    const mesh = new THREE.Group();
    vi.mocked(createCarMesh).mockReset().mockReturnValue(mesh);
    const rp = new RemotePlayers(makeMockScene(), "m", 90);
    // States broadcast one tick apart, but claiming a second between them:
    // 60 m in 1.05 s would pass for a car, 60 m in one 50 ms tick does not.
    rp.onSnapshot([{ ...makeSnapshot("a"), t: -950 }], 50);
    rp.onSnapshot([{ ...makeSnapshot("a"), x: 60, t: 100 }], 100);
    drawAt(rp, -425);
    expect(mesh.position.x).toBeCloseTo(30);
    expect(rp.obstacles()).toEqual([]);
    drawAt(rp, 100);
    expect(rp.obstacles()).toEqual([]);
  });

  it("passes through a car that reappears far away after its sender went quiet", () => {
    vi.mocked(createCarMesh)
      .mockReset()
      .mockImplementation(() => new THREE.Group());
    const rp = new RemotePlayers(makeMockScene(), "m", 90);
    // Parked, then two silent seconds in which every tick repeats the last state:
    // the repeats fold into one sample, but the silence is no time a car drove.
    for (let t = 0; t <= 1000; t += 50) rp.onSnapshot([{ ...makeSnapshot("a"), t }], t);
    for (let t = 1050; t < 3000; t += 50) rp.onSnapshot([{ ...makeSnapshot("a"), t: 1000 }], t);
    rp.onSnapshot([{ ...makeSnapshot("a"), x: 400, t: 3000 }], 3000);
    for (const t of [2990, 3007]) {
      drawAt(rp, t);
      expect(rp.obstacles()).toEqual([]);
    }
  });
});

describe("RemotePlayers with Direct Links", () => {
  // Pose n was current at server time 50n; the sender's clock reads 5 s behind
  // the server's, and the snapshot carrying it is broadcast 30 ms later.
  const SENDER_CLOCK = -5000;
  const relayed = (seq: number, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
    ...makeSnapshot("p1"),
    // 5 m per 50 ms pose: 100 m/s, just under the default (hard) top speed.
    x: seq * 5,
    speed: 20,
    t: seq * 50,
    stamp: { seq, epoch: 0, sentAt: seq * 50 + SENDER_CLOCK },
    direct: true,
    ...overrides,
  });
  const relay = (remote: RemotePlayers, seq: number) =>
    remote.onSnapshot([relayed(seq)], seq * 50 + 30);
  const direct = (seq: number, x = seq * 5, z = 0) => ({
    stamp: { seq, epoch: 0 },
    t: seq * 50 + SENDER_CLOCK,
    x,
    z,
    rot: 0,
    speed: 20,
  });

  let mesh: THREE.Group;
  let remote: RemotePlayers;

  beforeEach(() => {
    mesh = new THREE.Group();
    vi.mocked(createCarMesh).mockReset().mockReturnValue(mesh);
    remote = new RemotePlayers(makeMockScene(), "me");
  });

  it("draws a directly linked car sooner, placing its poses on the server clock", () => {
    relay(remote, 1);
    for (const seq of [2, 3, 4]) {
      remote.onDirectPose("p1", direct(seq));
      relay(remote, seq);
    }
    expect(remote.sources()).toEqual({ p1: "direct" });
    expect(remote.directPoses()).toEqual({ p1: 3 });
    // Drawn DIRECT_INTERPOLATION_DELAY_MS behind: server time 120, 40% from pose 2 to 3.
    remote.update(1 / 60, 120 + DIRECT_INTERPOLATION_DELAY_MS);
    expect(mesh.position.x).toBeCloseTo(12);
    expect(remote.obstacles()).toHaveLength(1);
  });

  it("keeps drawing relayed poses when the Direct Link falls silent", () => {
    relay(remote, 1);
    remote.onDirectPose("p1", direct(2));
    for (let seq = 2; seq <= 12; seq++) relay(remote, seq);
    expect(remote.sources()).toEqual({ p1: "relay" });
    drawAt(remote, 450);
    expect(mesh.position.x).toBeCloseTo(45);
  });

  it("counts a link as carrying the car until the relay runs more than two poses ahead of it", () => {
    relay(remote, 1);
    // A page drawing a few frames a second receives in bursts: direct, then relayed.
    for (const seq of [2, 3, 4]) remote.onDirectPose("p1", direct(seq));
    for (const seq of [2, 3, 4, 5, 6]) relay(remote, seq);
    expect(remote.sources()).toEqual({ p1: "direct" });
    relay(remote, 7);
    expect(remote.sources()).toEqual({ p1: "relay" });
  });

  it("draws from the relay when it, not the Direct Link, delivers poses first", () => {
    for (const seq of [1, 2, 3, 4, 5]) {
      relay(remote, seq);
      remote.onDirectPose("p1", direct(seq));
    }
    expect(remote.sources()).toEqual({ p1: "relay" });
    expect(remote.directPoses()).toEqual({ p1: 0 });
  });

  it("stops trusting a Direct Link whose copy of a pose differs from the relayed one", () => {
    relay(remote, 1);
    remote.onDirectPose("p1", direct(2, 500));
    relay(remote, 2);
    expect(remote.sources()).toEqual({ p1: "relay" });
    // Later Direct Link poses are ignored and the forged one is gone.
    remote.onDirectPose("p1", direct(3, 900));
    drawAt(remote, 100);
    expect(mesh.position.x).toBe(10);
  });

  it("never collides with a Direct Link pose the car could not have reached from its relayed one", () => {
    for (const seq of [1, 2, 3]) relay(remote, seq);
    // Each forged hop is a plausible 11 m in 50 ms, so the motion alone looks
    // drivable; but it veers away from where the server last saw the car.
    remote.onDirectPose("p1", direct(4, 20, 10));
    remote.onDirectPose("p1", direct(5, 25, 20));
    expect(remote.sources()).toEqual({ p1: "direct" });
    // Drawn between the two forged poses.
    remote.update(1 / 60, 230 + DIRECT_INTERPOLATION_DELAY_MS);
    expect(mesh.position.z).toBeCloseTo(16);
    expect(remote.obstacles()).toEqual([]);
  });

  it("ignores Direct Link poses before the relay has placed the car, or far ahead of it", () => {
    remote.onDirectPose("p1", direct(1));
    remote.onDirectPose("ghost", direct(1));
    expect(remote.positions()).toEqual([]);
    relay(remote, 1);
    remote.onDirectPose("p1", direct(100));
    expect(remote.sources()).toEqual({ p1: "relay" });
    expect(remote.directPoses()).toEqual({ p1: 0 });
  });

  it("keeps a car's Direct Link state when its mesh is rebuilt for a new name", () => {
    relay(remote, 1);
    remote.onDirectPose("p1", direct(2));
    remote.onSnapshot([relayed(2, { name: "Renamed" })], 130);
    expect(remote.sources()).toEqual({ p1: "direct" });
    expect(remote.directPoses()).toEqual({ p1: 1 });
  });
});
