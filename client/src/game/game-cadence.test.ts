// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Game } from "./game";
import { Net } from "../net";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = {};
      setPixelRatio() {}
      setSize() {}
      render = vi.fn();
      forceContextLoss() {}
      dispose() {}
    },
  };
});
vi.mock("./trackMesh", () => ({ buildTrack() {} }));

let now = 0;
let frame: FrameRequestCallback;
let game: Game;
let carMesh: THREE.Group;

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
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
});
afterEach(() => {
  game?.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tick(milliseconds: number): void {
  now += milliseconds;
  frame(now);
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
    const firstDistance = carMesh.position.clone();
    respawn();
    const spawn = carMesh.position.clone();
    tick(1); // A sub-step frame must stay at spawn, never blend from the old lap.
    expect(carMesh.position.distanceTo(spawn)).toBe(0);
    const expectedDistance = firstDistance.distanceTo(spawn);
    now += 400; // A long frame before the keypress must not advance the new car.
    respawn();
    tick(1000 / 60);
    expect(carMesh.position.distanceTo(spawn)).toBeCloseTo(expectedDistance, 10);
  });
});
