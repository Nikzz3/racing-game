import * as THREE from "three";
import { hashString } from "../util";

const CAR_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xfd79a8,
];

export function colorForPlayer(id: string): number {
  return CAR_COLORS[hashString(id) % CAR_COLORS.length];
}

/** Low-poly arcade car. Local forward is +z, so mesh.rotation.y = heading works directly. */
export function createCarMesh(color: number, name?: string): THREE.Group {
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

  // Fake contact shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  if (name) {
    group.add(createNameTag(name));
  }
  return group;
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
