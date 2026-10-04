import { afterEach, describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { SCENE_PRESETS, SUNSET_RIDGE, type ScenePreset } from "@racing/shared";
import { createScene, disposeRenderer, disposeWorld, updateSun, type SceneBundle } from "./scene";
import { buildTrack } from "./trackMesh";

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

function world(preset?: ScenePreset) {
  vi.stubGlobal("devicePixelRatio", 1);
  const container = { clientWidth: 1280, clientHeight: 720, append: vi.fn() };
  return createScene(container as unknown as HTMLElement, SUNSET_RIDGE.samples, preset);
}

function skyOf(bundle: SceneBundle) {
  return bundle.scene.getObjectByName("sky") as THREE.Mesh<
    THREE.SphereGeometry,
    THREE.ShaderMaterial
  >;
}

describe("sky and lighting", () => {
  it.each(SCENE_PRESETS)(
    "%s keeps the visible sun aligned with tree shadows and fades scenery into its horizon",
    (preset) => {
      const bundle = world(preset);
      const { uniforms } = skyOf(bundle).material;
      const direction = uniforms.sunDirection.value as THREE.Vector3;
      for (const [x, z] of [
        [0, 0],
        [300, -220],
        [-410, 390],
      ]) {
        updateSun(bundle, x, z);
        const lightDirection = bundle.sun.position
          .clone()
          .sub(bundle.sun.target.position)
          .normalize();
        expect(lightDirection.distanceTo(direction)).toBeLessThan(1e-10);
      }
      const fog = bundle.scene.fog as THREE.Fog;
      expect(fog.color.equals(uniforms.horizon.value as THREE.Color)).toBe(true);
      expect(bundle.sun.castShadow).toBe(true);
      expect(bundle.sun.shadow.mapSize.x).toBe(1024);
      disposeWorld(bundle);
    },
  );

  it("renders the sunset low sun and long view unless a preset is given", () => {
    const bundle = world();
    const direction = skyOf(bundle).material.uniforms.sunDirection.value as THREE.Vector3;
    expect(direction.y).toBeGreaterThan(0.1);
    expect(direction.y).toBeLessThan(0.25);
    const fog = bundle.scene.fog as THREE.Fog;
    expect([fog.color.getHex(), fog.near, fog.far]).toEqual([0xe4ad80, 190, 820]);
    expect([bundle.sun.color.getHex(), bundle.sun.intensity]).toEqual([0xffb45f, 3.8]);
    disposeWorld(bundle);
  });

  it("closes a foggy morning in so corners appear late", () => {
    const bundle = world("foggy-morning");
    const fog = bundle.scene.fog as THREE.Fog;
    expect(fog.near).toBeLessThanOrEqual(60);
    expect(fog.far).toBeLessThanOrEqual(260);
    disposeWorld(bundle);
  });

  it("releases sky GPU resources without disposing reusable asset geometry", () => {
    const bundle = world();
    const sky = skyOf(bundle);
    const disposeSkyGeometry = vi.spyOn(sky.geometry, "dispose");
    const disposeSkyMaterial = vi.spyOn(sky.material, "dispose");
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

describe("static scenery", () => {
  it("bakes world transforms once while the sun keeps following the car", () => {
    const bundle = world();
    const sky = skyOf(bundle);
    const ground = bundle.scene.children.find(
      (child) => child instanceof THREE.Mesh && child !== sky,
    )!;
    // Scenery is placed before freezing, so its baked matrix is already correct.
    const flat = new THREE.Vector3(0, 0, 1).applyMatrix4(ground.matrixWorld);
    expect(flat.y).toBeCloseTo(-0.015 + 1, 10);
    const recompose = vi.spyOn(ground, "updateMatrix");
    updateSun(bundle, 120, -80);
    bundle.scene.updateMatrixWorld();
    expect(recompose).not.toHaveBeenCalled();
    const target = new THREE.Vector3().setFromMatrixPosition(bundle.sun.target.matrixWorld);
    expect(target.toArray()).toEqual([120, 0, -80]);
    expect(new THREE.Vector3().setFromMatrixPosition(bundle.sun.matrixWorld).x).toBe(270);
    disposeWorld(bundle);
  });

  it("freezes the circuit once it is built", () => {
    const bundle = world();
    const before = bundle.scene.children.length;
    buildTrack(bundle.scene, SUNSET_RIDGE);
    const circuit = bundle.scene.children.slice(before);
    expect(circuit).toHaveLength(1);
    circuit[0].traverse((part) => expect(part.matrixAutoUpdate).toBe(false));
    disposeWorld(bundle);
  });
});

describe("disposeRenderer", () => {
  it("calls forceContextLoss before dispose", () => {
    const calls: string[] = [];
    const renderer = {
      forceContextLoss: vi.fn(() => {
        calls.push("forceContextLoss");
      }),
      dispose: vi.fn(() => {
        calls.push("dispose");
      }),
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
