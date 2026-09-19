import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const library = new Map<string, THREE.Group>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
let ready = false;
let pending: Promise<void> | undefined;
// Resolved against Vite's base so the packaged desktop build (base "./") can load it too.
const ASSET_LIBRARY_URL = `${import.meta.env.BASE_URL}models/rework/sunset-ridge.glb`;

/** Blender collection names are preserved in glTF extras even after Three sanitizes node names. */
export function registerLibrary(root: THREE.Group): void {
  root.traverse((node) => {
    const name: string = node.userData.name ?? node.name;
    if (!/^(car|nature|prop|track|preview|environment):/.test(name)) return;
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
    if (name.startsWith("car:")) {
      // The source lays cars out on a workshop floor. Remove that display offset.
      const bounds = new THREE.Box3().setFromObject(group, true);
      const center = bounds.getCenter(new THREE.Vector3());
      const offset = new THREE.Vector3(center.x, bounds.min.y, center.z);
      for (const child of group.children) child.position.sub(offset);
      group.updateMatrixWorld(true);
      separateHeadlightLenses(group);
    } else {
      group.updateMatrixWorld(true);
      if (name.startsWith("nature:")) batchNatureSurfaces(group);
    }
    library.set(name, group);
  });
}

/** Nature is static. Bake diffuse tints into linear vertex colors so equivalent
 * surfaces share one draw per spatial batch, in both the color and shadow passes.
 * The resulting geometry/material live with the reusable asset library. */
function batchNatureSurfaces(model: THREE.Group): void {
  const batches = new Map<string, BatchableMesh[]>();
  model.traverseVisible((part) => {
    if (!isBatchable(part)) return;
    const key = `${materialBatchKey(part.material)}|${geometryLayoutKey(part.geometry)}`;
    const batch = batches.get(key);
    if (batch) batch.push(part);
    else batches.set(key, [part]);
  });
  for (const parts of batches.values()) {
    if (parts.length < 2) continue;
    const geometries = parts.map((part) => {
      const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
      const count = geometry.attributes.position.count;
      const colors = new Float32Array(count * 3);
      const existing = part.material.vertexColors ? geometry.getAttribute("color") : undefined;
      const tint = part.material.color;
      for (let index = 0; index < count; index++) {
        colors[index * 3] = tint.r * (existing?.getX(index) ?? 1);
        colors[index * 3 + 1] = tint.g * (existing?.getY(index) ?? 1);
        colors[index * 3 + 2] = tint.b * (existing?.getZ(index) ?? 1);
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const geometry = mergeGeometries(geometries);
    for (const source of geometries) source.dispose();
    if (!geometry) continue;
    const material = parts[0].material.clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${model.name}:batched`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (const part of parts) part.removeFromParent();
    model.add(mesh);
    mesh.updateMatrixWorld(true);
  }
}

type BatchableMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** Only rigid, opaque, unmirrored standard surfaces merge cleanly into one draw. */
function isBatchable(part: THREE.Object3D): part is BatchableMesh {
  if (!(part instanceof THREE.Mesh) || part instanceof THREE.SkinnedMesh) return false;
  if (!(part.material instanceof THREE.MeshStandardMaterial)) return false;
  if (part.material.transparent) return false;
  if (part.geometry.getAttribute("color")?.itemSize === 4) return false;
  if (part.geometry.morphAttributes.position) return false;
  return part.matrixWorld.determinant() > 0;
}

/** The shading inputs that must match for two surfaces to share a material.
 * The diffuse colour is deliberately absent: it is baked into vertex colours. */
function materialBatchKey(material: THREE.MeshStandardMaterial): string {
  return [
    material.roughness,
    material.metalness,
    material.emissive.getHex(),
    material.emissiveIntensity,
    material.opacity,
    material.alphaTest,
    material.side,
    material.flatShading,
    material.map?.uuid,
    material.normalMap?.uuid,
    material.roughnessMap?.uuid,
    material.metalnessMap?.uuid,
    material.emissiveMap?.uuid,
    material.aoMap?.uuid,
  ].join(",");
}

/** Attribute layouts must match for merging (UVs, normals, tangents, etc.). */
function geometryLayoutKey(geometry: THREE.BufferGeometry): string {
  const layout = Object.entries(geometry.attributes)
    .map(([name, attribute]) =>
      `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`)
    .sort()
    .join(";");
  return `${Boolean(geometry.index)}|${layout}`;
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

export type ModelLoadProgress = {
  phase: "loading" | "preparing" | "ready" | "error";
  loaded: number;
  total: number;
};
let loadProgress: ModelLoadProgress = { phase: "loading", loaded: 0, total: 0 };
const loadObservers = new Set<(progress: ModelLoadProgress) => void>();
function reportLoad(progress: ModelLoadProgress): void {
  loadProgress = progress;
  for (const observer of loadObservers) observer(progress);
}

export function preloadModels(onProgress?: (progress: ModelLoadProgress) => void): Promise<void> {
  if (onProgress) {
    onProgress(loadProgress);
    if (!ready) loadObservers.add(onProgress);
  }
  return (pending ??= new GLTFLoader()
    .loadAsync(ASSET_LIBRARY_URL, (event) => reportLoad({
      phase: "loading", loaded: event.loaded, total: event.lengthComputable ? event.total : 0,
    }))
    .then(({ scene }) => {
      reportLoad({ ...loadProgress, phase: "preparing" });
      registerLibrary(scene);
      reportLoad({ ...loadProgress, phase: "ready" });
    })
    .catch((error: unknown) => {
      console.warn("Blender asset library could not load", error);
      reportLoad({ ...loadProgress, phase: "error" });
    })
    .finally(() => {
      ready = true;
      loadObservers.clear();
    }));
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
  if (transforms.length === 0) return group;
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
    if (!(part instanceof THREE.Mesh)) return;
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
