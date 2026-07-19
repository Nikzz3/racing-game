import * as THREE from "three";
import { CHECKPOINT_RADIUS, type ReplayFrame } from "@racing/shared";
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
 * Derives the Pacer's first entry time (ms, lap-relative) for each checkpoint,
 * scanning frames forward in lap order. The crossing time is interpolated to the
 * exact instant the Pacer first enters `radius` of each point. Returns null for
 * any checkpoint the Pacer's frames never reach within the radius.
 * Times are monotonically non-decreasing by construction (frames are only
 * scanned forward for each successive checkpoint).
 */
export function pacerCheckpointTimes(
  frames: ReplayFrame[],
  checkpoints: { x: number; z: number }[],
  radius = CHECKPOINT_RADIUS
): (number | null)[] {
  const result: (number | null)[] = [];
  let scanFrom = 0;
  const r2 = radius * radius;

  for (const cp of checkpoints) {
    let found: number | null = null;

    for (let i = scanFrom; i < frames.length; i++) {
      const [t, fx, fz] = frames[i];
      const dx = fx - cp.x;
      const dz = fz - cp.z;
      if (dx * dx + dz * dz < r2) {
        if (i > scanFrom) {
          // Interpolate the exact entry time using the quadratic distance equation.
          // frames[i-1] is guaranteed outside the radius (otherwise the loop would
          // have broken at i-1), so we can solve for the boundary crossing fraction.
          const [t0, x0, z0] = frames[i - 1];
          const ddx = fx - x0;
          const ddz = fz - z0;
          const ex = x0 - cp.x;
          const ez = z0 - cp.z;
          const A = ddx * ddx + ddz * ddz;
          if (A > 0) {
            const B = 2 * (ex * ddx + ez * ddz);
            const C = ex * ex + ez * ez - r2;
            const disc = B * B - 4 * A * C;
            const frac = disc >= 0
              ? Math.max(0, Math.min(1, (-B - Math.sqrt(disc)) / (2 * A)))
              : 0;
            found = t0 + (t - t0) * frac;
          } else {
            found = t0;
          }
        } else {
          found = t;
        }
        scanFrom = i;
        break;
      }
    }

    result.push(found);
  }

  return result;
}

/**
 * Signed delta between driver and Pacer at a Checkpoint (ms).
 * Negative → driver is ahead; positive → driver is behind.
 * Returns null if the Pacer never crossed that Checkpoint.
 */
export function pacerDelta(
  pacerCpTimes: (number | null)[],
  cpIndex: number,
  driverLapTimeMs: number
): number | null {
  if (cpIndex < 0 || cpIndex >= pacerCpTimes.length) return null;
  const t = pacerCpTimes[cpIndex];
  if (t === null) return null;
  return driverLapTimeMs - t;
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

  /** Load replay frames. Playback stays hidden until restart() is called. */
  setFrames(frames: ReplayFrame[]): void {
    this.frames = frames;
    this.startMs = null;
    this.mesh.visible = false;
  }

  /** Restart from frame zero (driver crossed the start line). */
  restart(): void {
    if (!this.frames.length) return;
    this.startMs = performance.now();
  }

  /** Hide after a Respawn; re-appears on the next restart() call. */
  onRespawn(): void {
    this.startMs = null;
    this.mesh.visible = false;
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
