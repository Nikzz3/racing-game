import * as THREE from "three";
import type { Variant } from "@racing/shared";
import { hashString } from "../util";
import { CAR_VARIANTS, getModel } from "./models";

const COLORS = [
  0xd65b34, 0x4b7e9d, 0x688b56, 0xd2ac4a, 0x987caa, 0xb77b42, 0x438d86,
  0xcc8591,
];
interface MovingParts {
  wheels: THREE.Object3D[];
  fronts: THREE.Object3D[];
  radius: number;
}
export function colorForPlayer(id: string): number {
  return COLORS[hashString(id) % COLORS.length];
}
export function resolveVariant(id: string, variant?: Variant): Variant {
  return variant ?? CAR_VARIANTS[hashString(id) % CAR_VARIANTS.length];
}

export function createCarMesh(
  id: string,
  name?: string,
  variant?: Variant,
): THREE.Group {
  const car = new THREE.Group();
  const source = getModel(`car:${resolveVariant(id, variant)}`);
  if (source) {
    const body = source.clone(true);
    const bounds = new THREE.Box3().setFromObject(body, true);
    const scale = 4.2 / Math.max(0.01, bounds.max.z - bounds.min.z);
    body.scale.setScalar(scale);
    body.position.y = -bounds.min.y * scale;
    const wheels: THREE.Object3D[] = [];
    body.traverse((part) => {
      if (part instanceof THREE.Mesh) {
        part.castShadow = true;
        part.receiveShadow = true;
      }
      if (part.name.startsWith("wheel_") && !(part instanceof THREE.Mesh)) {
        part.rotation.order = "YXZ";
        wheels.push(part);
      }
    });
    car.userData.parts = {
      wheels,
      fronts: wheels.filter((w) => w.name.includes("front")),
      radius: 0.43 * scale,
    } satisfies MovingParts;
    car.add(body);
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.65, 4.2),
      new THREE.MeshStandardMaterial({ color: colorForPlayer(id) }),
    );
    body.position.y = 0.6;
    body.userData.owned = true;
    car.add(body);
  }
  if (name) car.add(nameTag(name));
  return car;
}
export function animateCar(
  car: THREE.Group,
  speed: number,
  steer: number,
  dt: number,
): void {
  const parts = car.userData.parts as MovingParts | undefined;
  if (!parts) return;
  for (const wheel of parts.wheels)
    wheel.rotation.x += (speed * dt) / parts.radius;
  for (const wheel of parts.fronts) wheel.rotation.y = steer * 0.45;
}
export function disposeCarMesh(car: THREE.Group): void {
  car.traverse((part) => {
    if (part instanceof THREE.Sprite) {
      part.material.map?.dispose();
      part.material.dispose();
    }
    if (part instanceof THREE.Mesh && part.userData.owned) {
      part.geometry.dispose();
      const materials = Array.isArray(part.material)
        ? part.material
        : [part.material];
      materials.forEach((material) => material.dispose());
    }
  });
}
function nameTag(name: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(21,32,32,.86)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 8);
  ctx.fill();
  ctx.font = "600 26px sans-serif";
  ctx.fillStyle = "#f4f0e5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.slice(0, 14), 128, 34);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
    }),
  );
  sprite.position.y = 2.8;
  sprite.scale.set(4.4, 1.1, 1);
  return sprite;
}
