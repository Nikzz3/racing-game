import * as THREE from "three";
import { CAR_VARIANTS, type Variant } from "@racing/shared";
import { hashString } from "../util";
import { getModel } from "./models";

const COLORS = [0xd65b34, 0x4b7e9d, 0x688b56, 0xd2ac4a, 0x987caa, 0xb77b42, 0x438d86, 0xcc8591];
interface MovingParts {
  wheels: THREE.Object3D[];
  fronts: THREE.Object3D[];
  radius: number;
}
interface BodyFit {
  scale: number;
  lift: number;
}
// Exact bounds visit every vertex, which takes milliseconds per car and far
// longer for the densest models. Library models never change, so fit each once
// instead of stalling a frame whenever a car spawns mid-race.
const bodyFits = new WeakMap<THREE.Object3D, BodyFit>();
/** `body` is a fresh, unscaled clone of `source`, measured on the first call only. */
function bodyFit(source: THREE.Object3D, body: THREE.Object3D): BodyFit {
  let fit = bodyFits.get(source);
  if (!fit) {
    const bounds = new THREE.Box3().setFromObject(body, true);
    const scale = 4.2 / Math.max(0.01, bounds.max.z - bounds.min.z);
    fit = { scale, lift: -bounds.min.y * scale };
    bodyFits.set(source, fit);
  }
  return fit;
}

export function resolveVariant(id: string, variant?: Variant): Variant {
  return variant ?? CAR_VARIANTS[hashString(id) % CAR_VARIANTS.length];
}

export function createCarMesh(id: string, name?: string, variant?: Variant): THREE.Group {
  const car = new THREE.Group();
  const source = getModel(`car:${resolveVariant(id, variant)}`);
  if (source) {
    const body = source.clone(true);
    const { scale, lift } = bodyFit(source, body);
    body.scale.setScalar(scale);
    body.position.y = lift;
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
      new THREE.MeshStandardMaterial({
        color: COLORS[hashString(id) % COLORS.length],
      }),
    );
    body.position.y = 0.6;
    body.userData.owned = true;
    car.add(body);
  }
  if (name)
    car.add(
      labelSprite(name.slice(0, 14), {
        background: "rgba(21,32,32,.86)",
        radius: 8,
        font: "600 26px sans-serif",
        color: "#f4f0e5",
        y: 2.8,
      }),
    );
  return car;
}
export function animateCar(car: THREE.Group, speed: number, steer: number, dt: number): void {
  const parts = car.userData.parts as MovingParts | undefined;
  if (!parts) return;
  for (const wheel of parts.wheels) wheel.rotation.x += (speed * dt) / parts.radius;
  for (const wheel of parts.fronts) wheel.rotation.y = steer * 0.45;
}
/** Releases the name tag and any fallback box; Blender geometry is shared. */
export function disposeCarMesh(car: THREE.Group): void {
  car.traverse((part) => {
    if (part instanceof THREE.Sprite) {
      part.material.map?.dispose();
      part.material.dispose();
    }
    if (part instanceof THREE.Mesh && part.userData.owned) {
      part.geometry.dispose();
      disposeMaterials(part.material);
    }
  });
}
export function disposeMaterials(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((m) => m.dispose());
  else material.dispose();
}
/** A canvas-textured pill floating above a car. */
export function labelSprite(
  text: string,
  style: {
    background: string;
    radius: number;
    font: string;
    color: string;
    y: number;
  },
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = style.background;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, style.radius);
  ctx.fill();
  ctx.font = style.font;
  ctx.fillStyle = style.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
    }),
  );
  sprite.position.y = style.y;
  sprite.scale.set(4.4, 1.1, 1);
  return sprite;
}
