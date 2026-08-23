import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CAR_VARIANTS } from "@racing/shared";

// The Variant list lives in @racing/shared (it travels on the wire); re-export
// it so existing client importers are untouched.
export { CAR_VARIANTS };

const NATURE_MODELS = [
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
] as const;

const models = new Map<string, THREE.Group>();
let modelsLoaded = false;

/**
 * Swaps PBR materials for Lambert. The scene's lighting is tuned for the flat low-poly
 * look and leaves MeshStandardMaterial far too dark.
 */
function toLambert(scene: THREE.Group): void {
  const cache = new Map<string, THREE.MeshLambertMaterial>();
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const convert = (mat: THREE.Material): THREE.Material => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
      let lambert = cache.get(mat.uuid);
      if (!lambert) {
        lambert = new THREE.MeshLambertMaterial({
          color: mat.color,
          map: mat.map,
          transparent: mat.transparent,
          opacity: mat.opacity,
          side: mat.side,
        });
        cache.set(mat.uuid, lambert);
      }
      return lambert;
    };
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(convert)
      : convert(obj.material);
  });
}

/** Loads all GLB models up front. Missing files are logged and skipped (procedural fallbacks kick in). */
export async function preloadModels(): Promise<void> {
  const loader = new GLTFLoader();
  const entries: { key: string; url: string }[] = [
    ...CAR_VARIANTS.map((v) => ({ key: `car:${v}`, url: `/models/cars/${v}.glb` })),
    ...NATURE_MODELS.map((v) => ({ key: `nature:${v}`, url: `/models/nature/${v}.glb` })),
  ];
  await Promise.all(
    entries.map(async ({ key, url }) => {
      try {
        const gltf = await loader.loadAsync(url);
        toLambert(gltf.scene);
        models.set(key, gltf.scene);
      } catch (err) {
        console.warn(`Failed to load model ${url}`, err);
      }
    })
  );
  modelsLoaded = true;
}

/** True once preloadModels() has resolved (whether or not every model loaded successfully). */
export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

export function getModel(key: string): THREE.Group | null {
  return models.get(key) ?? null;
}

/**
 * Builds instanced meshes from every mesh inside a loaded model, one InstancedMesh per
 * (geometry, material) pair, applying each transform on top of the mesh's own local transform.
 * Far cheaper than cloning the model N times.
 */
export function instancedFromModel(
  model: THREE.Group,
  transforms: THREE.Matrix4[],
  shadows = true
): THREE.Group {
  model.updateMatrixWorld(true);
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const inst = new THREE.InstancedMesh(obj.geometry, obj.material, transforms.length);
    for (let i = 0; i < transforms.length; i++) {
      m.multiplyMatrices(transforms[i], obj.matrixWorld);
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = shadows;
    inst.receiveShadow = shadows;
    group.add(inst);
  });
  return group;
}
