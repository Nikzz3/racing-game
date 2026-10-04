import * as THREE from "three";
import {
  nearestCenterline,
  ROAD_HALF_WIDTH,
  type ScenePreset,
  type TrackSample,
} from "@racing/shared";
import { disposeMaterials } from "./car";
import { getMaterial, getModel, instancedFromModel, setTextureAnisotropy } from "./models";
import { renderQuality } from "./quality";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  /** Where the sun stays relative to the car it follows. */
  sunOffset: THREE.Vector3;
}

/** How a Scene Preset colours and lights the world. */
interface SceneLook {
  /** The sky draws the sun's disk in the direction of the light's offset. */
  sun: { offset: THREE.Vector3; color: number; intensity: number };
  /** `horizon` is also the fog, so distant scenery fades into the sky. */
  sky: {
    zenith: number;
    horizon: number;
    glow: number;
    /** Linear, and above 1 so tone mapping keeps the disk brighter than the sky. */
    disk: [r: number, g: number, b: number];
  };
  fog: { near: number; far: number };
  hemisphere: { sky: number; ground: number; intensity: number };
}

const LOOKS: Record<ScenePreset, SceneLook> = {
  sunset: {
    // A low sun casts tree silhouettes across the verge and lights the starting straight.
    sun: { offset: new THREE.Vector3(150, 30, -65), color: 0xffb45f, intensity: 3.8 },
    sky: { zenith: 0x536b89, horizon: 0xe4ad80, glow: 0xffad54, disk: [5, 1.9, 0.35] },
    fog: { near: 190, far: 820 },
    hemisphere: { sky: 0xbcc8e2, ground: 0x745038, intensity: 1.25 },
  },
  "golden-hour": {
    sun: { offset: new THREE.Vector3(150, 70, -65), color: 0xffc35c, intensity: 4.8 },
    sky: { zenith: 0x7aa6dc, horizon: 0xf6cf8e, glow: 0xffc65a, disk: [4.5, 3.2, 1.4] },
    fog: { near: 230, far: 960 },
    hemisphere: { sky: 0xa9bde0, ground: 0x7a5a3a, intensity: 1.1 },
  },
  dusk: {
    // Half set: the light only grazes the ground, so the sky lights the road.
    sun: { offset: new THREE.Vector3(150, 1.5, -65), color: 0xff7a4a, intensity: 2 },
    sky: { zenith: 0x283463, horizon: 0x8c6b91, glow: 0xff6a3a, disk: [2, 0.32, 0.08] },
    fog: { near: 150, far: 640 },
    hemisphere: { sky: 0x9aa0d8, ground: 0x5a4050, intensity: 2 },
  },
  "foggy-morning": {
    // Corners loom out of the fog late; the low eastern sun only whitens it.
    sun: { offset: new THREE.Vector3(-150, 55, 65), color: 0xfff1dc, intensity: 1.2 },
    sky: { zenith: 0xb9c3cc, horizon: 0xd3d8dc, glow: 0xfff6e0, disk: [1.8, 1.75, 1.6] },
    fog: { near: 40, far: 240 },
    hemisphere: { sky: 0xe0e6ee, ground: 0x8c8a7c, intensity: 2 },
  },
};
const FOLLOW_DISTANCE = 10;
const EYE_HEIGHT = 4.6;
const look = new THREE.Vector3();
const eye = new THREE.Vector3();

export function createScene(
  container: HTMLElement,
  samples: TrackSample[],
  preset: ScenePreset = "sunset",
): SceneBundle {
  const { sun: light, sky, fog, hemisphere } = LOOKS[preset];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky.horizon);
  scene.fog = new THREE.Fog(sky.horizon, fog.near, fog.far);
  scene.add(createSky(sky, light.offset));
  const camera = new THREE.PerspectiveCamera(
    64,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    1500,
  );
  const quality = renderQuality();
  const renderer = new THREE.WebGLRenderer({
    antialias: quality.antialias,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.maxPixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity));
  const sun = new THREE.DirectionalLight(light.color, light.intensity);
  sun.position.copy(light.offset);
  sun.castShadow = quality.shadows;
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
  // Textures upload per context, so a new race picks up a lowered tier's filtering.
  setTextureAnisotropy(quality.anisotropy);
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
  // Everything added so far stays put; only the sun and its target follow the car.
  // The root never moves either, so it stops re-forcing every descendant's update.
  for (const child of scene.children)
    if (child !== sun && child !== sun.target) freezeStatic(child);
  scene.matrixAutoUpdate = false;
  return { scene, camera, renderer, sun, sunOffset: light.offset };
}

/**
 * Bake the transforms of scenery that never moves again. Three otherwise
 * recomposes every object's matrix each frame, and the scattered nature alone
 * is hundreds of instanced batches. Call once the subtree is fully placed.
 */
export function freezeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((part) => {
    part.matrixAutoUpdate = false;
  });
}

function createSky(colors: SceneLook["sky"], sunOffset: THREE.Vector3): THREE.Mesh {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: sunOffset.clone().normalize() },
        zenith: { value: new THREE.Color(colors.zenith) },
        horizon: { value: new THREE.Color(colors.horizon) },
        dusk: { value: new THREE.Color(0x9a6c65) },
        glow: { value: new THREE.Color(colors.glow) },
        disk: { value: new THREE.Color(...colors.disk) },
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
        uniform vec3 disk;
        varying vec3 skyDirection;
        void main() {
          vec3 direction = normalize(skyDirection);
          float height = max(direction.y, 0.0);
          vec3 color = mix(horizon, zenith, pow(height, 0.48));
          color = mix(color, dusk, smoothstep(0.0, 0.35, -direction.y));
          float alignment = max(dot(direction, sunDirection), 0.0);
          // Broad atmospheric warmth and a small halo, in the same draw as the sky.
          color += glow * (pow(alignment, 18.0) * 0.24 + pow(alignment, 190.0) * 0.48);
          // A sun on the horizon is cut by it, and one below it draws no disk at all.
          float sunDisk = smoothstep(0.99954, 0.99966, alignment) * step(0.0, direction.y);
          color = mix(color, disk, sunDisk);
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
  sky.name = "sky";
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
      disposeMaterials(part.material);
    }
  });
  sun.shadow.dispose();
  disposeRenderer(renderer);
  scene.clear();
}
export function updateSun({ sun, sunOffset }: SceneBundle, x: number, z: number): void {
  sun.position.set(x + sunOffset.x, sunOffset.y, z + sunOffset.z);
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
    const placements = new Map(spec.names.map((name) => [name, [] as THREE.Matrix4[]]));
    for (let placed = 0, attempt = 0; placed < spec.count && attempt < spec.count * 25; attempt++) {
      const x = (random() - 0.5) * 820,
        z = (random() - 0.5) * 820;
      if (nearestCenterline(x, z, samples).dist < ROAD_HALF_WIDTH + spec.clearance) continue;
      const start = samples[0],
        dx = x - start.x,
        dz = z - start.z;
      const alongStart = dx * start.dirX + dz * start.dirZ;
      const besideStart = -dx * start.dirZ + dz * start.dirX;
      if (Math.abs(alongStart) < 65 && besideStart > 10 && besideStart < 48) continue;
      position.set(x, 0, z);
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * Math.PI * 2);
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
