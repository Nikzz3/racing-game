import * as THREE from "three";
import { nearestCenterline, ROAD_HALF_WIDTH } from "@racing/shared";
import { getModel, instancedFromModel } from "./models";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
}

/** Sun offset from the followed car; matches the original light direction. */
const SUN_OFFSET = new THREE.Vector3(-130, 150, -65);

export function createScene(container: HTMLElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2a86e);
  scene.fog = new THREE.Fog(0xf2a86e, 250, 700);

  const camera = new THREE.PerspectiveCamera(
    70,
    container.clientWidth / container.clientHeight,
    0.1,
    1200
  );
  camera.position.set(0, 60, -220);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Warm late-afternoon light
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x3a5b3a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc080, 1.25);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(900, 48),
    new THREE.MeshLambertMaterial({ color: 0x4d8a4a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addEnvironment(scene);

  return { scene, camera, renderer, sun };
}

/** Keeps the shadow camera centered on the action so shadows stay crisp everywhere on the map. */
export function updateSun(sun: THREE.DirectionalLight, x: number, z: number): void {
  sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  sun.target.position.set(x, 0, z);
}

interface ScatterSpec {
  /** Nature model names; each placement picks one at random. */
  models: string[];
  count: number;
  minClearance: number;
  scaleMin: number;
  scaleMax: number;
  shadows?: boolean;
}

const SCATTER: ScatterSpec[] = [
  {
    models: ["tree_detailed", "tree_default", "tree_oak", "tree_pineDefaultA", "tree_pineDefaultB"],
    count: 150,
    minClearance: 18,
    scaleMin: 9,
    scaleMax: 16,
  },
  { models: ["rock_largeA", "rock_largeC", "rock_largeE"], count: 36, minClearance: 16, scaleMin: 4, scaleMax: 9 },
  { models: ["grass_large"], count: 110, minClearance: 8, scaleMin: 3.5, scaleMax: 6, shadows: false },
  {
    models: ["flower_redA", "flower_yellowA"],
    count: 70,
    minClearance: 8,
    scaleMin: 3,
    scaleMax: 5,
    shadows: false,
  },
];

function addEnvironment(scene: THREE.Scene): void {
  if (!getModel("nature:tree_detailed")) {
    addFallbackTrees(scene);
    return;
  }

  for (const spec of SCATTER) {
    // Bucket transforms per model variant so each variant becomes one set of instanced meshes.
    const buckets = new Map<string, THREE.Matrix4[]>(spec.models.map((m) => [m, []]));
    let attempts = 0;
    let placed = 0;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    while (placed < spec.count && attempts < spec.count * 20) {
      attempts++;
      const x = (Math.random() - 0.5) * 780;
      const z = (Math.random() - 0.5) * 780;
      if (nearestCenterline(x, z).dist < ROAD_HALF_WIDTH + spec.minClearance) continue;
      const s = spec.scaleMin + Math.random() * (spec.scaleMax - spec.scaleMin);
      pos.set(x, 0, z);
      quat.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      scl.setScalar(s);
      const variant = spec.models[Math.floor(Math.random() * spec.models.length)];
      buckets.get(variant)!.push(new THREE.Matrix4().compose(pos, quat, scl));
      placed++;
    }

    for (const [variant, transforms] of buckets) {
      if (transforms.length === 0) continue;
      const model = getModel(`nature:${variant}`);
      if (!model) continue;
      scene.add(instancedFromModel(model, transforms, spec.shadows ?? true));
    }
  }
}

/** Procedural cone trees, used only if the GLB models failed to load. */
function addFallbackTrees(scene: THREE.Scene): void {
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 6);
  const leavesGeo = new THREE.ConeGeometry(3.2, 8, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5e4630 });
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2f6b35 });

  const positions: { x: number; z: number; s: number }[] = [];
  let attempts = 0;
  while (positions.length < 140 && attempts < 2000) {
    attempts++;
    const x = (Math.random() - 0.5) * 760;
    const z = (Math.random() - 0.5) * 760;
    if (nearestCenterline(x, z).dist < ROAD_HALF_WIDTH + 18) continue;
    positions.push({ x, z, s: 0.7 + Math.random() * 0.8 });
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const leaves = new THREE.InstancedMesh(leavesGeo, leavesMat, positions.length);
  const m = new THREE.Matrix4();
  positions.forEach((p, i) => {
    m.makeScale(p.s, p.s, p.s).setPosition(p.x, 2 * p.s, p.z);
    trunks.setMatrixAt(i, m);
    m.makeScale(p.s, p.s, p.s).setPosition(p.x, 7.5 * p.s, p.z);
    leaves.setMatrixAt(i, m);
  });
  scene.add(trunks, leaves);
}
