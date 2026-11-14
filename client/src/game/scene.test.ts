import { afterEach, describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { SCENE_PRESETS, SUNSET_RIDGE, type ScenePreset } from "@racing/shared";
import { createScene, disposeRenderer, disposeWorld, updateSun, type SceneBundle } from "./scene";
import { buildTrack } from "./trackMesh";
import { registerLibrary } from "./models";
import { downgradeQuality } from "./quality";

const gl = vi.hoisted(() => ({ multiDraw: false }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = new EventTarget();
      shadowMap = {};
      extensions = { has: (name: string) => name === "WEBGL_multi_draw" && gl.multiDraw };
      info = { reset() {} };
      renderLists = { dispose() {} };
      setPixelRatio() {}
      setSize() {}
      forceContextLoss = vi.fn();
      dispose = vi.fn();
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

describe("race renderer", () => {
  it("serves every world until its context is lost or the quality tier changes", () => {
    const first = world();
    disposeWorld(first);
    const second = world();
    expect(second.renderer).toBe(first.renderer);
    expect(first.renderer.dispose).not.toHaveBeenCalled();
    disposeWorld(second);

    first.renderer.domElement.dispatchEvent(new Event("webglcontextlost"));
    const restored = world();
    expect(restored.renderer).not.toBe(first.renderer);
    expect(first.renderer.dispose).toHaveBeenCalledOnce();
    disposeWorld(restored);

    vi.spyOn(console, "info").mockImplementation(() => {});
    downgradeQuality();
    const lowered = world();
    expect(lowered.renderer).not.toBe(restored.renderer);
    expect(restored.renderer.dispose).toHaveBeenCalledOnce();
    disposeWorld(lowered);
  });
});

describe("scattered nature", () => {
  it("draws each surface as one batch of every placement where the context can multi-draw", () => {
    const root = new THREE.Group();
    for (const name of [
      "tree_detailed",
      "tree_default",
      "tree_oak",
      "tree_pineDefaultA",
      "tree_pineDefaultB",
      "rock_largeA",
      "rock_largeC",
      "rock_largeE",
      "grass_large",
      "flower_redA",
      "flower_yellowA",
    ]) {
      const model = new THREE.Group();
      model.name = `nature:${name}`;
      model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      root.add(model);
    }
    registerLibrary(root);
    const scenery = (multiDraw: boolean) => {
      gl.multiDraw = multiDraw;
      const bundle = world();
      const meshes: (THREE.InstancedMesh | THREE.BatchedMesh)[] = [];
      bundle.scene.traverse((part) => {
        if (part instanceof THREE.InstancedMesh || part instanceof THREE.BatchedMesh)
          meshes.push(part);
      });
      disposeWorld(bundle);
      gl.multiDraw = false;
      const placements = meshes.reduce(
        (sum, mesh) => sum + (mesh instanceof THREE.BatchedMesh ? mesh.instanceCount : mesh.count),
        0,
      );
      return { meshes, placements };
    };
    const cells = scenery(false);
    const batches = scenery(true);
    expect(batches.meshes).toHaveLength(11);
    expect(batches.meshes.every((mesh) => mesh instanceof THREE.BatchedMesh)).toBe(true);
    expect(batches.placements).toBe(cells.placements);
    expect(cells.meshes.length).toBeGreaterThan(100);
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
