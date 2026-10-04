import * as THREE from "three";
import type { ReplayFrame, Variant } from "@racing/shared";
import { animateCar, createCarMesh, disposeMaterials, labelSprite, resolveVariant } from "./car";
import type { E2ePacerState } from "./e2e-seam";
import { interpolatePose, type Pose } from "./pose-interpolation";

const PACER_OPACITY = 0.35;

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

  /** The hidden car, for linking its shaders before it first appears. */
  get model(): THREE.Object3D {
    return this.mesh;
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

// The Pacer keeps its car's real colours and reads as a ghost purely through
// translucency, so it never looks like a differently painted opponent.
function ghosted(m: THREE.Material): THREE.Material {
  const cloned = m.clone();
  cloned.transparent = true;
  cloned.opacity = PACER_OPACITY;
  cloned.depthWrite = false;
  return cloned;
}

function createPacerMesh(driverName: string, variant: Variant): THREE.Group {
  const group = createCarMesh(driverName, undefined, variant);
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.material = Array.isArray(obj.material) ? obj.material.map(ghosted) : ghosted(obj.material);
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
  group.add(
    labelSprite("REPLAY", {
      background: "rgba(20, 20, 30, 0.6)",
      radius: 12,
      font: "bold 28px sans-serif",
      color: "#ffffff",
      y: 2.6,
    }),
  );
  return group;
}
