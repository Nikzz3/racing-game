import * as THREE from "three";
import { nearestCenterline, ROAD_HALF_WIDTH } from "@racing/shared";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
}

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
  container.appendChild(renderer.domElement);

  // Warm late-afternoon light
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x3a5b3a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc080, 1.25);
  sun.position.set(-180, 140, -90);
  scene.add(sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(900, 48),
    new THREE.MeshLambertMaterial({ color: 0x4d8a4a })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  addTrees(scene);

  return { scene, camera, renderer };
}

function addTrees(scene: THREE.Scene): void {
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
    // Keep trees well clear of the road and barriers.
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
