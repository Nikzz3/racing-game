import * as THREE from "three";
import {
  CHECKPOINT_RADIUS,
  type ReplayFrame,
  type Variant,
} from "@racing/shared";
import {
  animateCar,
  createCarMesh,
  disposeMaterials,
  labelSprite,
  resolveVariant,
} from "./car";
import type { E2ePacerState } from "./e2e-seam";
import { interpolatePose, type Pose } from "./pose-interpolation";

const PACER_COLOR = 0x00e5ff;
const PACER_OPACITY = 0.5;

/** Null before playback starts and once the recording has ended. */
export function pacerPoseAt(
  frames: ReplayFrame[],
  startMs: number | null,
  nowMs: number,
): Pose | null {
  if (!frames.length || startMs === null) return null;
  const elapsed = nowMs - startMs;
  if (elapsed < 0 || elapsed > frames[frames.length - 1][0]) return null;
  return interpolatePose(frames, elapsed);
}

/**
 * Lap-relative time (ms) the Pacer first enters each checkpoint's radius, or
 * null for any it never reaches. Frames are scanned forward from the previous
 * hit, so the times are non-decreasing in checkpoint order.
 */
export function pacerCheckpointTimes(
  frames: ReplayFrame[],
  checkpoints: { x: number; z: number }[],
  radius = CHECKPOINT_RADIUS,
): (number | null)[] {
  const r2 = radius * radius;
  let scanFrom = 0;
  return checkpoints.map((cp) => {
    for (let i = scanFrom; i < frames.length; i++) {
      const [t, fx, fz] = frames[i];
      const dx = fx - cp.x,
        dz = fz - cp.z;
      if (dx * dx + dz * dz >= r2) continue;
      const enteredBeforeScan = i === scanFrom;
      scanFrom = i;
      if (enteredBeforeScan) return t;
      // frames[i-1] is outside the radius, so solve |p0 + f*d - cp|² = r² for
      // the fraction f of the segment at which the Pacer crossed the boundary.
      const [t0, x0, z0] = frames[i - 1];
      const ddx = fx - x0,
        ddz = fz - z0,
        ex = x0 - cp.x,
        ez = z0 - cp.z;
      const A = ddx * ddx + ddz * ddz;
      if (A === 0) return t0;
      const B = 2 * (ex * ddx + ez * ddz);
      const C = ex * ex + ez * ez - r2;
      const disc = B * B - 4 * A * C;
      const frac =
        disc >= 0 ? Math.max(0, Math.min(1, (-B - Math.sqrt(disc)) / (2 * A))) : 0;
      return t0 + (t - t0) * frac;
    }
    return null;
  });
}

/** Negative when the driver reached the checkpoint before the Pacer. */
export function pacerDelta(
  pacerCrossingTimes: (number | null)[],
  cpIndex: number,
  driverLapTimeMs: number,
): number | null {
  const t = pacerCrossingTimes[cpIndex];
  return t == null ? null : driverLapTimeMs - t;
}

/** One translucent, non-colliding car in the Room's scene, driven by recorded frames. */
export class PacerOverlay {
  private mesh: THREE.Group;
  private frames: ReplayFrame[] = [];
  private startMs: number | null = null;
  private variant: Variant;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly driverName: string,
  ) {
    this.variant = resolveVariant(driverName);
    this.mesh = this.buildMesh();
  }

  private buildMesh(): THREE.Group {
    const mesh = createPacerMesh(this.driverName, this.variant);
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** Playback stays hidden until restart(). The recorded Variant wins; absent
   * (legacy laps) falls back to hashing the driver's name, like the ReplayViewer. */
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

  resolvedVariant(): Variant {
    return this.variant;
  }

  /** `nowMs` is the rAF timestamp, so the Pacer's t=0 is the local lap clock's t=0. */
  restart(nowMs: number): void {
    if (this.frames.length) this.startMs = nowMs;
  }

  isPlaying(): boolean {
    return this.startMs !== null;
  }

  state(): E2ePacerState {
    // The least-translucent car material governs whether the whole car reads
    // as translucent; the badge Sprite is not part of the car.
    let opacity = 0;
    this.mesh.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      for (const m of [obj.material].flat()) opacity = Math.max(opacity, m.opacity);
    });
    return {
      frameCount: this.frames.length,
      playing: this.isPlaying(),
      visible: this.mesh.visible,
      opacity,
    };
  }

  onRespawn(): void {
    this.startMs = null;
    this.mesh.visible = false;
  }

  update(nowMs: number, dt: number): void {
    const pose = pacerPoseAt(this.frames, this.startMs, nowMs);
    this.mesh.visible = pose !== null;
    if (!pose) return;
    this.mesh.position.set(pose.x, 0, pose.z);
    this.mesh.rotation.y = pose.heading;
    animateCar(this.mesh, pose.speed, 0, dt);
  }

  // Every material on the Pacer is a per-instance clone, unlike a plain car's
  // shared Blender materials, so dispose them all along with the badge.
  private removeMesh(): void {
    this.scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) disposeMaterials(obj.material);
      else if (obj instanceof THREE.Sprite) {
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

function tinted(m: THREE.Material): THREE.Material {
  const cloned = m.clone();
  cloned.transparent = true;
  cloned.opacity = PACER_OPACITY;
  cloned.depthWrite = false;
  if ("color" in cloned) (cloned as { color: THREE.Color }).color.setHex(PACER_COLOR);
  return cloned;
}

function createPacerMesh(driverName: string, variant: Variant): THREE.Group {
  const group = createCarMesh(driverName, undefined, variant);
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(tinted)
      : tinted(obj.material);
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
  group.add(
    labelSprite("REPLAY", {
      background: "rgba(0, 180, 200, 0.75)",
      radius: 12,
      font: "bold 28px sans-serif",
      color: "#ffffff",
      y: 2.6,
    }),
  );
  return group;
}
