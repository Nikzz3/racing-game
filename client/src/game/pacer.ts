import * as THREE from "three";
import type { ReplayFrame } from "@racing/shared";
import { animateCar, createCarMesh } from "./car";
import { interpolatePose, type Pose } from "./pose-interpolation";

const PACER_COLOR = 0x00e5ff;
const PACER_OPACITY = 0.5;

/**
 * Pure helper: returns interpolated pose at `nowMs` relative to `startMs`,
 * or null when playback hasn't started, frames are empty, elapsed is negative,
 * or the recording has ended.
 */
export function pacerPoseAt(
  frames: ReplayFrame[],
  startMs: number | null,
  nowMs: number
): Pose | null {
  if (!frames.length || startMs === null) return null;
  const elapsed = nowMs - startMs;
  if (elapsed < 0) return null;
  if (elapsed > frames[frames.length - 1][0]) return null;
  return interpolatePose(frames, elapsed);
}

/**
 * In-Room Pacer overlay: one translucent phantom car driven by recorded replay frames.
 * Modelled structurally on RemotePlayers — owns no camera, renderer, HUD, or rAF.
 * Disposed on `left` and on Game.dispose().
 */
export class PacerOverlay {
  private mesh: THREE.Group;
  private frames: ReplayFrame[] = [];
  private startMs: number | null = null;

  constructor(private scene: THREE.Scene) {
    this.mesh = createPacerMesh();
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Load replay frames; `startMs` anchors elapsed-time calculation (use performance.now()). */
  setFrames(frames: ReplayFrame[], startMs: number): void {
    this.frames = frames;
    this.startMs = startMs;
    this.mesh.visible = frames.length > 0;
  }

  update(nowMs: number, dt: number): void {
    const pose = pacerPoseAt(this.frames, this.startMs, nowMs);
    if (!pose) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(pose.x, 0, pose.z);
    this.mesh.rotation.y = pose.heading;
    animateCar(this.mesh, pose.speed, 0, dt);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.frames = [];
    this.startMs = null;
  }
}

function cloneMaterialForPacer(m: THREE.Material): THREE.Material {
  const cloned = m.clone();
  cloned.transparent = true;
  cloned.opacity = PACER_OPACITY;
  cloned.depthWrite = false;
  if ("color" in cloned) {
    (cloned as { color: THREE.Color }).color.setHex(PACER_COLOR);
  }
  return cloned;
}

function createPacerMesh(): THREE.Group {
  const group = createCarMesh("__pacer__");
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(cloneMaterialForPacer);
    } else {
      obj.material = cloneMaterialForPacer(obj.material);
    }
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
  group.add(createReplayBadge());
  return group;
}

function createReplayBadge(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0, 180, 200, 0.75)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 12);
  ctx.fill();
  ctx.font = "bold 28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("REPLAY", 128, 34);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.position.y = 2.6;
  sprite.scale.set(4.4, 1.1, 1);
  return sprite;
}
