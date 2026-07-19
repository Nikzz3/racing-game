import * as THREE from "three";
import { nearestCenterline, ROAD_HALF_WIDTH, type TrackSample } from "@racing/shared";
import { getModel, instancedFromModel } from "./models";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
}

/**
 * Sun offset from the followed car. Low elevation (~17 deg) for long sunset
 * shadows; the visible sun disc in the sky dome uses this same direction.
 */
const SUN_OFFSET = new THREE.Vector3(-130, 45, -65);

const HORIZON_COLOR = 0xf2a86e;

export function createScene(container: HTMLElement, samples: TrackSample[]): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON_COLOR);
  scene.fog = new THREE.Fog(HORIZON_COLOR, 250, 700);

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

  // Warm sunset light: low orange sun plus a dusky sky bounce.
  const hemi = new THREE.HemisphereLight(0xe8b8a0, 0x3a4b46, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa45e, 1.5);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Slightly wider box than before: the low sun stretches shadows further.
  sun.shadow.camera.left = -140;
  sun.shadow.camera.right = 140;
  sun.shadow.camera.top = 140;
  sun.shadow.camera.bottom = -140;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  scene.add(createSkyDome());

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(900, 48),
    new THREE.MeshLambertMaterial({ color: 0x4d8a4a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addEnvironment(scene, samples);

  return { scene, camera, renderer, sun };
}

/**
 * Properly tears down a WebGLRenderer: forceContextLoss() actively relinquishes
 * the WebGL context so the browser can reclaim it immediately, then dispose()
 * cleans up Three.js's internal caches. Without forceContextLoss(), the context
 * stays alive until GC, exhausting the browser's ~16-context limit on repeated
 * room joins/replays.
 */
export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.forceContextLoss();
  renderer.dispose();
}

/** Keeps the shadow camera centered on the action so shadows stay crisp everywhere on the map. */
export function updateSun(sun: THREE.DirectionalLight, x: number, z: number): void {
  sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  sun.target.position.set(x, 0, z);
}

const CAM_BACK_DIST = 10;
const CAM_EYE_HEIGHT = 4.6;
const CAM_LOOK_AHEAD = 4;
const CAM_LOOK_AT_HEIGHT = 1.4;
const CAM_FOLLOW_RATE = 6;

/** Instantly places the camera behind and above the car, facing the look-ahead point. */
export function snapBehindCar(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
  heading: number
): void {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  camera.position.set(x - fx * CAM_BACK_DIST, CAM_EYE_HEIGHT, z - fz * CAM_BACK_DIST);
  camera.lookAt(x + fx * CAM_LOOK_AHEAD, CAM_LOOK_AT_HEIGHT, z + fz * CAM_LOOK_AHEAD);
}

/** Smoothly follows the car each frame using exponential-decay lerp. */
export function followCar(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
  heading: number,
  dt: number
): void {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const target = new THREE.Vector3(x - fx * CAM_BACK_DIST, CAM_EYE_HEIGHT, z - fz * CAM_BACK_DIST);
  const k = 1 - Math.exp(-CAM_FOLLOW_RATE * dt);
  camera.position.lerp(target, k);
  camera.lookAt(x + fx * CAM_LOOK_AHEAD, CAM_LOOK_AT_HEIGHT, z + fz * CAM_LOOK_AHEAD);
}

/**
 * Gradient sunset sky with a sun disc drawn exactly along SUN_OFFSET, so the
 * visible sun sits where the shadows say it should be. The dome follows the
 * camera each frame, making it behave like an infinitely distant sky.
 */
function createSkyDome(): THREE.Mesh {
  const uniforms = {
    sunDirection: { value: SUN_OFFSET.clone().normalize() },
    topColor: { value: new THREE.Color(0x3b2e63) },
    midColor: { value: new THREE.Color(0xc96a6a) },
    horizonColor: { value: new THREE.Color(HORIZON_COLOR) },
    sunCoreColor: { value: new THREE.Color(0xfff3d0) },
    sunGlowColor: { value: new THREE.Color(0xffb36b) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDirection;
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 sunCoreColor;
      uniform vec3 sunGlowColor;
      varying vec3 vWorldPosition;

      void main() {
        vec3 dir = normalize(vWorldPosition - cameraPosition);
        float h = max(dir.y, 0.0);

        // Horizon -> dusty pink -> dusk purple gradient.
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.18, h));
        sky = mix(sky, topColor, smoothstep(0.12, 0.55, h));

        float cosAngle = clamp(dot(dir, sunDirection), 0.0, 1.0);
        // Broad warm haze around the sun, tighter glow, then the disc itself.
        sky += sunGlowColor * 0.25 * pow(cosAngle, 12.0);
        sky += sunGlowColor * 0.5 * pow(cosAngle, 180.0);
        sky = mix(sky, sunCoreColor, smoothstep(0.9994, 0.9998, cosAngle));

        gl_FragColor = vec4(sky, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  sky.frustumCulled = false;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld);
    sky.updateMatrixWorld();
  };
  return sky;
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

function addEnvironment(scene: THREE.Scene, samples: TrackSample[]): void {
  if (!getModel("nature:tree_detailed")) {
    addFallbackTrees(scene, samples);
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
      if (nearestCenterline(x, z, samples).dist < ROAD_HALF_WIDTH + spec.minClearance) continue;
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
function addFallbackTrees(scene: THREE.Scene, samples: TrackSample[]): void {
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
    if (nearestCenterline(x, z, samples).dist < ROAD_HALF_WIDTH + 18) continue;
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
