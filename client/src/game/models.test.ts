import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { getModel, preloadModels, registerLibrary } from "./models";

function meshesOf(object: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  object.traverse((part) => {
    if (part instanceof THREE.Mesh) meshes.push(part);
  });
  return meshes;
}

describe("preloadModels", () => {
  it("resolves when the library cannot be fetched, leaving every model absent", async () => {
    // The Node test environment has no server, so the GLTFLoader request fails.
    await expect(preloadModels()).resolves.toBeUndefined();
    expect(getModel("car:race")).toBeNull();
    expect(getModel("nature:tree_detailed")).toBeNull();
  });
});

it("reports cached failure to later callers without retrying or leaving them loading", async () => {
  await preloadModels();
  const progress: string[] = [];
  await preloadModels((state) => progress.push(state.phase));
  expect(progress).toEqual(["error"]);
});

it("batches static nature surfaces without changing their world positions or linear colors", () => {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = "nature:batch-fixture";
  root.add(model);
  const geometry = new THREE.BoxGeometry();
  const colors = [new THREE.Color(0.1, 0.3, 0.2), new THREE.Color(0.6, 0.4, 0.1)];
  for (const [index, color] of colors.entries()) {
    const branch = new THREE.Group();
    branch.position.set(index * 3, 1, 2);
    branch.rotation.y = (index * Math.PI) / 4;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    mesh.scale.set(1, 2, 3);
    branch.add(mesh);
    model.add(branch);
  }
  const originalBounds = new THREE.Box3().setFromObject(model, true);
  registerLibrary(root);
  const batched = getModel(model.name)!;
  const meshes = meshesOf(batched);
  expect(meshes).toHaveLength(1);
  const bounds = new THREE.Box3().setFromObject(batched, true);
  expect(bounds.min.distanceTo(originalBounds.min)).toBeLessThan(1e-6);
  expect(bounds.max.distanceTo(originalBounds.max)).toBeLessThan(1e-6);
  expect(meshes[0].geometry.index!.count).toBe(geometry.index!.count * 2);
  const attributes = meshes[0].geometry.attributes;
  expect(attributes.position.count).toBe(geometry.attributes.position.count * 2);
  const material = meshes[0].material as THREE.MeshStandardMaterial;
  expect(material.vertexColors).toBe(true);
  expect(material.color.getHex()).toBe(0xffffff);
  for (let index = 0; index < attributes.color.count; index++) {
    const expected = colors[Math.floor(index / geometry.attributes.position.count)];
    expect(attributes.color.getX(index)).toBeCloseTo(expected.r, 6);
    expect(attributes.color.getY(index)).toBeCloseTo(expected.g, 6);
    expect(attributes.color.getZ(index)).toBeCloseTo(expected.b, 6);
  }
  expect(geometry.attributes.color).toBeUndefined();
});

it("keeps nature materials with different lighting or transparency separate", () => {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = "nature:material-fixture";
  root.add(model);
  const materials = [
    new THREE.MeshStandardMaterial({ roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }),
  ];
  for (const material of materials) model.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  registerLibrary(root);
  expect(meshesOf(getModel(model.name)!).map((mesh) => mesh.material)).toEqual(materials);
});
