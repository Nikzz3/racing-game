import { afterEach, describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { SUNSET_RIDGE } from "@racing/shared";
import { createScene, disposeRenderer, disposeWorld, updateSun } from "./scene";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = {};
      shadowMap = {};
      setPixelRatio() {}
      setSize() {}
      forceContextLoss() {}
      dispose() {}
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

function world() {
  vi.stubGlobal("devicePixelRatio", 1);
  const container = { clientWidth: 1280, clientHeight: 720, append: vi.fn() };
  return createScene(container as unknown as HTMLElement, SUNSET_RIDGE.samples);
}

describe("sunset lighting", () => {
  it("keeps the visible sun aligned with tree shadows as the car crosses the world", () => {
    const bundle = world();
    const sky = bundle.scene.getObjectByName("sunset-sky") as THREE.Mesh<
      THREE.SphereGeometry, THREE.ShaderMaterial
    >;
    const direction = sky.material.uniforms.sunDirection.value as THREE.Vector3;
    for (const [x, z] of [[0, 0], [300, -220], [-410, 390]]) {
      updateSun(bundle.sun, x, z);
      const lightDirection = bundle.sun.position.clone().sub(bundle.sun.target.position).normalize();
      expect(lightDirection.distanceTo(direction)).toBeLessThan(1e-10);
    }
    expect(direction.y).toBeGreaterThan(0.1);
    expect(direction.y).toBeLessThan(0.25);
    expect(bundle.sun.castShadow).toBe(true);
    expect(bundle.sun.shadow.mapSize.x).toBe(1024);
    disposeWorld(bundle);
  });

  it("releases sky GPU resources without disposing reusable asset geometry", () => {
    const bundle = world();
    const sky = bundle.scene.getObjectByName("sunset-sky") as THREE.Mesh;
    const disposeSkyGeometry = vi.spyOn(sky.geometry, "dispose");
    const disposeSkyMaterial = vi.spyOn(sky.material as THREE.Material, "dispose");
    const sharedGeometry = new THREE.BoxGeometry();
    const sharedMaterial = new THREE.MeshStandardMaterial();
    bundle.scene.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
    const disposeSharedGeometry = vi.spyOn(sharedGeometry, "dispose");
    const disposeSharedMaterial = vi.spyOn(sharedMaterial, "dispose");
    disposeWorld(bundle);
    expect(disposeSkyGeometry).toHaveBeenCalledOnce();
    expect(disposeSkyMaterial).toHaveBeenCalledOnce();
    expect(disposeSharedGeometry).not.toHaveBeenCalled();
    expect(disposeSharedMaterial).not.toHaveBeenCalled();
    sharedGeometry.dispose();
    sharedMaterial.dispose();
  });
});

describe("disposeRenderer", () => {
  it("calls forceContextLoss before dispose", () => {
    const calls: string[] = [];
    const renderer = {
      forceContextLoss: vi.fn(() => { calls.push("forceContextLoss"); }),
      dispose: vi.fn(() => { calls.push("dispose"); }),
    };
    disposeRenderer(renderer as never);
    expect(calls).toEqual(["forceContextLoss", "dispose"]);
  });

  it("calls both forceContextLoss and dispose exactly once", () => {
    const renderer = {
      forceContextLoss: vi.fn(),
      dispose: vi.fn(),
    };
    disposeRenderer(renderer as never);
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
