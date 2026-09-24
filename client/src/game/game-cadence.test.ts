// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Game } from "./game";
import { Net } from "../net";

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
