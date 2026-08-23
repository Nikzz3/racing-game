import * as THREE from "three";
import { CHECKPOINT_RADIUS, type ReplayFrame, type Variant } from "@racing/shared";
import { animateCar, createCarMesh, resolveVariant } from "./car";
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
  pacerCrossingTimes: (number | null)[],
  cpIndex: number,
  driverLapTimeMs: number
): number | null {
  if (cpIndex < 0 || cpIndex >= pacerCrossingTimes.length) return null;
  const t = pacerCrossingTimes[cpIndex];
  if (t === null) return null;
  return driverLapTimeMs - t;
}

/**
 * In-Room Pacer overlay: one translucent Pacer car driven by recorded replay frames.
 * Modelled structurally on RemotePlayers — owns no camera, renderer, HUD, or rAF.
 * Disposed on `left` and on Game.dispose().
 */
export class PacerOverlay {
  private mesh: THREE.Group;
  private frames: ReplayFrame[] = [];
  private startMs: number | null = null;
  /** The Variant the current mesh renders: recorded, or the driver-name hash. */
  private variant: Variant;

  constructor(private scene: THREE.Scene, private driverName: string) {
    this.variant = resolveVariant(driverName);
    this.mesh = this.buildMesh();
  }

  private buildMesh(): THREE.Group {
    const mesh = createPacerMesh(this.driverName, this.variant);
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Load replay frames. Playback stays hidden until restart() is called.
   * The recorded Variant drives the mesh; absent (legacy laps) falls back to
   * hashing the recorded driver's name, matching the ReplayViewer (#121).
   */
  setFrames(frames: ReplayFrame[], variant?: Variant): void {
    this.frames = frames;
    this.startMs = null;
    const resolved = resolveVariant(this.driverName, variant);
    if (resolved !== this.variant) {
      this.removeMesh();
      this.variant = resolved;
      this.mesh = this.buildMesh();
    }
    this.mesh.visible = false;
  }

  /** The Variant the Pacer currently renders (surfaced through the e2e seam). */
  resolvedVariant(): Variant {
    return this.variant;
  }

  /**
   * Restart from frame zero (driver crossed the start line). `nowMs` is the
   * caller's rAF timestamp, so the Pacer's t=0 coincides exactly with the
   * local lap clock's t=0.
   */
  restart(nowMs: number): void {
    if (!this.frames.length) return;
    this.startMs = nowMs;
  }

  /** Whether the Pacer is actively playing back frames (started and has frames). */
  isPlaying(): boolean {
    return this.startMs !== null;
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

  // Release the per-instance GPU resources createPacerMesh() allocated: the
  // cloned car materials and the replay badge's SpriteMaterial + CanvasTexture.
  // Shared geometry is owned by createCarMesh() and left untouched, so repeated
  // arm/dismiss (and Variant rebuild) cycles don't leak GPU memory.
  private removeMesh(): void {
    this.scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) m.dispose();
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
  }

  dispose(): void {
    this.removeMesh();
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

function createPacerMesh(driverName: string, variant: Variant): THREE.Group {
  const group = createCarMesh(driverName, undefined, variant);
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
  group.add(createPacerBadge());
  return group;
}

/** The "REPLAY" pill above the Pacer (per PRD #27 story 13), replacing the name tag. */
function createPacerBadge(): THREE.Sprite {
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
