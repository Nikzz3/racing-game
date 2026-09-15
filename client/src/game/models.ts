import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CAR_VARIANTS } from "@racing/shared";
export { CAR_VARIANTS };

const library = new Map<string, THREE.Group>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
let ready = false;
let pending: Promise<void> | undefined;
/** Resolved against Vite's base so the packaged desktop build (base "./") can load it too. */
export const ASSET_LIBRARY_URL = `${import.meta.env.BASE_URL}models/rework/sunset-ridge.glb`;

/** Blender collection names are preserved in glTF extras even after Three sanitizes node names. */
export function registerLibrary(root: THREE.Group): void {
  root.traverse((node) => {
    const name: string = node.userData.name ?? node.name;
    if (!/^(car|nature|prop|track|preview):/.test(name)) return;
    const group = new THREE.Group();
    group.name = name;
    for (const child of node.children) group.add(child.clone(true));
    group.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      part.castShadow = true;
      part.receiveShadow = true;
      const meshMaterials = Array.isArray(part.material)
        ? part.material
        : [part.material];
      for (const material of meshMaterials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        materials.set(material.name, material);
        for (const texture of [
          material.map,
          material.normalMap,
          material.roughnessMap,
        ]) {
          if (texture) texture.anisotropy = 8;
        }
      }
    });
    // The source lays cars out on a workshop floor. Remove that display offset.
    if (name.startsWith("car:")) {
      const bounds = new THREE.Box3().setFromObject(group, true);
      const center = bounds.getCenter(new THREE.Vector3());
      for (const child of group.children)
        child.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    }
    group.updateMatrixWorld(true);
    if (name.startsWith("car:")) separateHeadlightLenses(group);
    library.set(name, group);
  });
}

/** The authored front lenses coincide with the enamel. Keep a physical gap so
 * both the color and shadow passes have distinct surfaces at every view angle. */
function separateHeadlightLenses(car: THREE.Group): void {
  const front = new THREE.Box3().setFromObject(car, true).max.z;
  const point = new THREE.Vector3();
  car.traverse((part) => {
    if (!(part instanceof THREE.Mesh) || !part.name.includes("Warm_headlights"))
      return;
    // The taxi roof sign shares this material/mesh; only move the front lenses.
    const geometry = part.geometry.clone();
    const positions = geometry.getAttribute("position");
    const inverse = part.matrixWorld.clone().invert();
    for (let index = 0; index < positions.count; index++) {
      point
        .fromBufferAttribute(positions, index)
        .applyMatrix4(part.matrixWorld);
      if (point.z < front - 0.2) continue;
      point.z += 0.012;
      point.applyMatrix4(inverse);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    part.geometry = geometry;
  });
}

export function preloadModels(): Promise<void> {
  return (pending ??= new GLTFLoader()
    .loadAsync(ASSET_LIBRARY_URL)
    .then(({ scene }) => registerLibrary(scene))
    .catch((error: unknown) =>
      console.warn("Blender asset library could not load", error),
    )
    .finally(() => {
      ready = true;
    }));
}
export function areModelsLoaded(): boolean {
  return ready;
}
export function getModel(key: string): THREE.Group | null {
  return library.get(key) ?? null;
}

/** Reuse Blender-authored surfaces on terrain created by the game. */
export function getMaterial(name: string): THREE.MeshStandardMaterial | null {
  return materials.get(name) ?? null;
}

/** Share geometry and materials across all placements; each mesh is one draw call. */
export function instancedFromModel(
  model: THREE.Group,
  transforms: THREE.Matrix4[],
  shadows = true,
): THREE.Group {
  const group = new THREE.Group();
  model.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4();
  // Small spatial batches let both the camera and shadow pass reject offscreen trees.
  // One world-wide instance buffer would draw every placement whenever any is visible.
  const cells = new Map<string, THREE.Matrix4[]>();
  for (const transform of transforms) {
    const key = `${Math.floor(transform.elements[12] / 100)},${Math.floor(transform.elements[14] / 100)}`;
    const cell = cells.get(key);
    if (cell) cell.push(transform);
    else cells.set(key, [transform]);
  }
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh) || transforms.length === 0) return;
    for (const placements of cells.values()) {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        placements.length,
      );
      placements.forEach((placement, index) =>
        mesh.setMatrixAt(
          index,
          matrix.multiplyMatrices(placement, part.matrixWorld),
        ),
      );
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });
  return group;
}
