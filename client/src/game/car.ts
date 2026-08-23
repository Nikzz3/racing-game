import * as THREE from "three";
import type { Variant } from "@racing/shared";
import { hashString } from "../util";
import { CAR_VARIANTS, getModel } from "./models";

const CAR_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xfd79a8,
];

const TARGET_LENGTH = 4.2;

interface CarParts {
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  /** World-space wheel radius, for converting speed to spin. */
  wheelRadius: number;
  /** -1 when the model was rotated 180° to face +z, so wheels spin the right way. */
  spinSign: number;
}

export function colorForPlayer(id: string): number {
  return CAR_COLORS[hashString(id) % CAR_COLORS.length];
}

/**
 * Resolves the Variant to render: an explicit choice wins; absent falls back to
 * the stable hash-of-player-id assignment.
 */
export function resolveVariant(playerId: string, variant?: Variant): Variant {
  return variant ?? CAR_VARIANTS[hashString(playerId) % CAR_VARIANTS.length];
}

/**
 * Car mesh for a player. Uses a Kenney Car Kit GLB (explicit variant, or picked
 * from the player id), falling back to a simple procedural car if the model
 * failed to load. Local forward is +z, so mesh.rotation.y = heading works directly.
 */
export function createCarMesh(playerId: string, name?: string, variant?: Variant): THREE.Group {
  const model = getModel(`car:${resolveVariant(playerId, variant)}`);
  const group = new THREE.Group();

  if (model) {
    const inner = model.clone(true);
    inner.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(inner);
    const length = box.max.z - box.min.z;
    const scale = TARGET_LENGTH / length;
    inner.scale.setScalar(scale);
    inner.position.y = -box.min.y * scale;

    const wheelObjs: THREE.Object3D[] = [];
    let wheelRadius = 0.35;
    inner.traverse((obj) => {
      if (!obj.name.startsWith("wheel")) return;
      obj.rotation.order = "YXZ"; // yaw for steering, then x-spin for rolling
      wheelObjs.push(obj);
      const wheelBox = new THREE.Box3().setFromObject(obj);
      wheelRadius = ((wheelBox.max.y - wheelBox.min.y) / 2) * scale;
    });

    // Road wheels sit off to the left/right; a back-mounted spare wheel sits on the
    // car's centerline. Only the off-center road wheels should roll while driving.
    const maxAbsX = Math.max(0, ...wheelObjs.map((w) => Math.abs(w.position.x)));
    const sideThreshold = maxAbsX * 0.5;
    const wheels: THREE.Object3D[] = [];
    const frontWheels: THREE.Object3D[] = [];
    for (const obj of wheelObjs) {
      if (Math.abs(obj.position.x) < sideThreshold) continue; // skip centerline spare
      wheels.push(obj);
      if (obj.name.includes("front")) frontWheels.push(obj);
    }

    // If "front" wheels sit at -z, the model faces -z and needs a half turn.
    let spinSign = 1;
    if (frontWheels.length > 0 && frontWheels[0].position.z < 0) {
      inner.rotation.y = Math.PI;
      spinSign = -1;
    }

    group.add(inner);
    group.userData.parts = { wheels, frontWheels, wheelRadius, spinSign } satisfies CarParts;
  } else {
    group.add(buildFallbackCar(colorForPlayer(playerId)));
  }

  if (name) {
    group.add(createNameTag(name));
  }
  return group;
}

/** Spins the wheels with speed and yaws the front wheels with steering input. */
export function animateCar(car: THREE.Group, speed: number, steer: number, dt: number): void {
  const parts = car.userData.parts as CarParts | undefined;
  if (!parts) return;
  const spin = (speed / parts.wheelRadius) * dt * parts.spinSign;
  for (const wheel of parts.wheels) wheel.rotation.x += spin;
  for (const wheel of parts.frontWheels) wheel.rotation.y = steer * 0.45;
}

function buildFallbackCar(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x16181f });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.55, 4.2), bodyMat);
  body.position.y = 0.55;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.9), darkMat);
  cabin.position.set(0, 1.0, -0.35);
  group.add(cabin);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.55), bodyMat);
  spoiler.position.set(0, 1.05, -2.0);
  group.add(spoiler);

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [
    [1.05, 1.35],
    [-1.05, 1.35],
    [1.05, -1.35],
    [-1.05, -1.35],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.position.set(wx, 0.42, wz);
    group.add(wheel);
  }

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  return group;
}

/** Disposes GPU resources (SpriteMaterial + CanvasTexture) held by name-tag sprites. */
export function disposeCarMesh(car: THREE.Group): void {
  car.traverse((obj) => {
    if (obj instanceof THREE.Sprite) {
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  });
}

function createNameTag(name: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(10, 12, 20, 0.65)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 12);
  ctx.fill();
  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.slice(0, 14), 128, 34);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.position.y = 2.6;
  sprite.scale.set(4.4, 1.1, 1);
  return sprite;
}
