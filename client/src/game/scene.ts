import * as THREE from "three";
import {
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type TrackSample,
} from "@racing/shared";
import { getMaterial, getModel, instancedFromModel } from "./models";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
}
// A low sun casts tree silhouettes across the verge and lights the starting straight.
const SUN = new THREE.Vector3(150, 30, -65);
const HORIZON = 0xe4ad80;
const FOLLOW_DISTANCE = 10;
const EYE_HEIGHT = 4.6;
const look = new THREE.Vector3();
const eye = new THREE.Vector3();

export function createScene(
  container: HTMLElement,
  samples: TrackSample[],
): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 190, 820);
  scene.add(createSunsetSky());
  const camera = new THREE.PerspectiveCamera(
    64,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    1500,
  );
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xbcc8e2, 0x745038, 1.25));
  const sun = new THREE.DirectionalLight(0xffb45f, 3.8);
  sun.position.copy(SUN);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -65,
    right: 65,
    top: 65,
    bottom: -65,
    near: 1,
    far: 400,
  });
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.16;
  scene.add(sun, sun.target);
  const groundGeometry = new THREE.CircleGeometry(1100, 64);
  const positions = groundGeometry.getAttribute("position");
  const uv = groundGeometry.getAttribute("uv");
  // Four metres per texture tile, independent of the terrain's overall radius.
  for (let index = 0; index < positions.count; index++) {
    uv.setXY(index, positions.getX(index) / 4, positions.getY(index) / 4);
  }
  const groundMaterial =
    getMaterial("leafy_grass")?.clone() ??
    new THREE.MeshStandardMaterial({ color: 0x73834d, roughness: 1 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  ground.userData.owned = true;
  scene.add(ground);
  scatterEnvironment(scene, samples);
  return { scene, camera, renderer, sun };
}

function createSunsetSky(): THREE.Mesh {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: SUN.clone().normalize() },
        zenith: { value: new THREE.Color(0x536b89) },
        horizon: { value: new THREE.Color(HORIZON) },
        dusk: { value: new THREE.Color(0x9a6c65) },
        glow: { value: new THREE.Color(0xffad54) },
      },
      vertexShader: `
        varying vec3 skyDirection;
        void main() {
          skyDirection = position;
          // Only camera rotation affects the sky: driving cannot move the sun.
          vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = clip.xyww;
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 dusk;
        uniform vec3 glow;
        varying vec3 skyDirection;
        void main() {
          vec3 direction = normalize(skyDirection);
          float height = max(direction.y, 0.0);
          vec3 color = mix(horizon, zenith, pow(height, 0.48));
          color = mix(color, dusk, smoothstep(0.0, 0.35, -direction.y));
          float alignment = max(dot(direction, sunDirection), 0.0);
          // Broad atmospheric warmth and a small halo, in the same draw as the sky.
          color += glow * (pow(alignment, 18.0) * 0.24 + pow(alignment, 190.0) * 0.48);
          float disk = smoothstep(0.99954, 0.99966, alignment);
          color = mix(color, vec3(5.0, 1.9, 0.35), disk);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  sky.name = "sunset-sky";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.userData.owned = true;
  return sky;
}

export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.forceContextLoss();
  renderer.dispose();
}
export function disposeWorld({ scene, renderer, sun }: SceneBundle): void {
  scene.traverse((part) => {
    if (part instanceof THREE.InstancedMesh) part.dispose();
    if (part instanceof THREE.Mesh && part.userData.owned) {
      part.geometry.dispose();
      const materials = Array.isArray(part.material)
        ? part.material
        : [part.material];
      materials.forEach((material) => material.dispose());
    }
  });
  sun.shadow.dispose();
  disposeRenderer(renderer);
  scene.clear();
}
export function updateSun(
  sun: THREE.DirectionalLight,
  x: number,
  z: number,
): void {
  sun.position.set(x + SUN.x, SUN.y, z + SUN.z);
  sun.target.position.set(x, 0, z);
}
function cameraTargets(x: number, z: number, heading: number): void {
  const dx = Math.sin(heading),
    dz = Math.cos(heading);
  eye.set(x - dx * FOLLOW_DISTANCE, EYE_HEIGHT, z - dz * FOLLOW_DISTANCE);
  look.set(x + dx * 4, 1.4, z + dz * 4);
}
export function snapBehindCar(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
  heading: number,
): void {
  cameraTargets(x, z, heading);
  camera.position.copy(eye);
  camera.lookAt(look);
}
export function followCar(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
  heading: number,
  dt: number,
): void {
  cameraTargets(x, z, heading);
  camera.position.lerp(eye, 1 - Math.exp(-6 * Math.max(0, dt)));
  camera.lookAt(look);
}

function scatterEnvironment(scene: THREE.Scene, samples: TrackSample[]): void {
  let seed = 7193;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const categories = [
    {
      names: [
        "tree_detailed",
        "tree_default",
        "tree_oak",
        "tree_pineDefaultA",
        "tree_pineDefaultB",
      ],
      count: 220,
      clearance: 19,
      min: 8,
      range: 8,
      shadow: true,
    },
    {
      names: ["rock_largeA", "rock_largeC", "rock_largeE"],
      count: 65,
      clearance: 15,
      min: 3,
      range: 7,
      shadow: true,
    },
    {
      names: ["grass_large", "flower_redA", "flower_yellowA"],
      count: 210,
      clearance: 9,
      min: 2,
      range: 3,
      shadow: false,
    },
  ];
  const position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  for (const spec of categories) {
    const placements = new Map(
      spec.names.map((name) => [name, [] as THREE.Matrix4[]]),
    );
    for (
      let placed = 0, attempt = 0;
      placed < spec.count && attempt < spec.count * 25;
      attempt++
    ) {
      const x = (random() - 0.5) * 820,
        z = (random() - 0.5) * 820;
      if (
        nearestCenterline(x, z, samples).dist <
        ROAD_HALF_WIDTH + spec.clearance
      )
        continue;
      const start = samples[0],
        dx = x - start.x,
        dz = z - start.z;
      const alongStart = dx * start.dirX + dz * start.dirZ;
      const besideStart = -dx * start.dirZ + dz * start.dirX;
      if (Math.abs(alongStart) < 65 && besideStart > 10 && besideStart < 48)
        continue;
      position.set(x, 0, z);
      rotation.setFromAxisAngle(
        THREE.Object3D.DEFAULT_UP,
        random() * Math.PI * 2,
      );
      scale.setScalar(spec.min + random() * spec.range);
      placements
        .get(spec.names[Math.floor(random() * spec.names.length)])!
        .push(new THREE.Matrix4().compose(position, rotation, scale));
      placed++;
    }
    for (const [name, matrices] of placements) {
      const model = getModel(`nature:${name}`);
      if (model) scene.add(instancedFromModel(model, matrices, spec.shadow));
    }
  }
}
