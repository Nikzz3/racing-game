// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ClientMessage, PlayerSnapshot } from "@racing/shared";
import { Game } from "./game";
import { Net } from "../net";
import type { DirectLinks } from "../direct-links";
import { Hud } from "../ui/hud";

const linking = vi.hoisted(() => ({ programs: [] as { isReady(): boolean }[] }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = {};
      setPixelRatio() {}
      getPixelRatio() {
        return 1;
      }
      setSize() {}
      extensions = { has: () => true };
      compile() {}
      info = {
        get programs() {
          return linking.programs;
        },
      };
      render = vi.fn();
      forceContextLoss() {}
      dispose() {}
    },
  };
});
vi.mock("./trackMesh", () => ({ buildTrack() {} }));

let now = 0;
let frame: FrameRequestCallback | undefined;
let game: Game;
let carMesh: THREE.Group;

beforeEach(async () => {
  now = 0;
  frame = undefined;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  // jsdom has no 2D canvas for the precompiled name tag; the race starts regardless.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(Net.prototype, "send").mockImplementation(() => {});
  const add = vi.spyOn(THREE.Scene.prototype, "add");
  game = new Game(document.body, new Net(), "local", "Test room", () => {});
  carMesh = add.mock.calls.flat().find((object) => object instanceof THREE.Group)! as THREE.Group;
  // The frame loop starts once the shaders are linked.
  await vi.waitFor(() => expect(frame).toBeDefined());
});
afterEach(() => {
  linking.programs = [];
  game?.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tick(milliseconds: number): void {
  now += milliseconds;
  frame!(now);
}
function throttle(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
}
function respawn(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" }));
}

describe("local car render cadence", () => {
  it.each([60, 90, 144, 165])("avoids alternating short and long movements at %i Hz", (fps) => {
    throttle();
    for (let i = 0; i < Math.ceil(fps / 2); i++) tick(1000 / fps);
    const previous = carMesh.position.clone();
    let velocity: THREE.Vector3 | undefined;
    for (let i = 0; i < Math.ceil(fps / 2); i++) {
      tick(1000 / fps);
      const nextVelocity = carMesh.position.clone().sub(previous).multiplyScalar(fps);
      // Engine acceleration is at most 65 m/s². Quantized poses create much
      // larger apparent acceleration as frames alternate physics step counts.
      if (velocity) expect(nextVelocity.distanceTo(velocity) * fps).toBeLessThan(80);
      velocity = nextVelocity;
      previous.copy(carMesh.position);
    }
  });

  it.each([false, true])("moves on every 144 Hz frame (respawn: %s)", (afterRespawn) => {
    throttle();
    for (let i = 0; i < 60; i++) tick(1000 / 144);
    if (afterRespawn) {
      respawn();
      for (let i = 0; i < 60; i++) tick(1000 / 144);
    }
    let frozenFrames = 0;
    const previous = carMesh.position.clone();
    for (let i = 0; i < 72; i++) {
      tick(1000 / 144);
      if (carMesh.position.distanceTo(previous) < 1e-9) frozenFrames++;
      previous.copy(carMesh.position);
    }
    expect(frozenFrames).toBe(0);
  });

  it("starts the respawn timeline at the keypress, discarding pre-respawn frame time", () => {
    throttle();
    tick(1000 / 60);
    const beforeRespawn = carMesh.position.clone();
    respawn();
    const spawn = carMesh.position.clone();
    tick(1); // A sub-step frame must stay at spawn, never blend from the old lap.
    expect(carMesh.position.distanceTo(spawn)).toBe(0);
    const expectedDistance = beforeRespawn.distanceTo(spawn);
    now += 400; // A long frame before the keypress must not advance the new car.
    respawn();
    tick(1000 / 60);
    expect(carMesh.position.distanceTo(spawn)).toBeCloseTo(expectedDistance, 10);
  });

  it("stops waiting for the shader link once the race is left", async () => {
    frame = undefined;
    const isReady = vi.fn(() => false);
    linking.programs = [{ isReady }];
    const early = new Game(document.body, new Net(), "early", "Test room", () => {});
    await vi.waitFor(() => expect(isReady).toHaveBeenCalled());
    early.dispose();
    const polls = isReady.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A poll after dispose() would read the disposed renderer's programs.
    expect(isReady).toHaveBeenCalledTimes(polls);
    expect(frame).toBeUndefined();
  });
});

describe("pose stamps", () => {
  it("stamps every sent pose, sends the same pose over Direct Links, and marks respawns", () => {
    game.dispose();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const broadcast = vi.fn();
    const links = { broadcast, onPose: () => () => {} } as unknown as DirectLinks;
    const send = vi.mocked(Net.prototype.send);
    send.mockClear();
    game = new Game(
      document.body,
      new Net(),
      "local",
      "Linked",
      () => {},
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      links,
    );
    const sendAt = (time: number) => {
      now = time;
      vi.advanceTimersByTime(50);
    };
    sendAt(1000);
    sendAt(1050);
    respawn();
    sendAt(1100);
    vi.useRealTimers();

    const states = send.mock.calls
      .map(([message]) => message)
      .filter(
        (message): message is Extract<ClientMessage, { type: "state" }> => message.type === "state",
      );
    expect(states.map((state) => state.stamp)).toEqual([
      { seq: 1, epoch: 0 },
      { seq: 2, epoch: 0 },
      { seq: 3, epoch: 1 },
    ]);
    // Both paths carry identical values, which is how receivers spot a forged copy.
    expect(broadcast.mock.calls.map(([pose]) => pose)).toEqual(
      states.map(({ x, z, rot, speed, t, stamp }) => ({ stamp, t, x, z, rot, speed })),
    );
  });
});

describe("local lap timer", () => {
  it("ticks with the frames however late each snapshot carrying the lap start arrives", () => {
    const shown = vi.spyOn(Hud.prototype, "setCurrentLap");
    const me: PlayerSnapshot = {
      id: "local",
      name: "Racer",
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      speed: 0,
      laps: 0,
      lastLapMs: null,
      bestLapMs: null,
      // On the server's clock, which reads 50 s behind this one.
      lapStartT: -60_000,
      nextCheckpoint: 1,
      spawns: 0,
    };
    let seed = 3;
    const late = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return 10 + (seed / 2_147_483_648) * 40;
    };
    let broadcast = 0;
    let arrives = late();
    const lap: { at: number; ms: number }[] = [];
    for (let i = 0; i < 180; i++) {
      tick(1000 / 60);
      // Snapshots land between frames, 10-50 ms after the server's 50 ms tick.
      while (arrives <= now) {
        game.onMessage({ type: "snapshot", t: broadcast - 50_000, players: [me] });
        broadcast += 50;
        arrives = Math.max(arrives, broadcast + late());
      }
      if (i >= 30) lap.push({ at: now, ms: shown.mock.lastCall![0]! });
    }
    for (let i = 1; i < lap.length; i++) {
      const elapsed = lap[i].at - lap[i - 1].at;
      expect(lap[i].ms - lap[i - 1].ms).toBeGreaterThanOrEqual(0.95 * elapsed - 1e-9);
      expect(lap[i].ms - lap[i - 1].ms).toBeLessThanOrEqual(1.05 * elapsed + 1e-9);
    }
  });
});
