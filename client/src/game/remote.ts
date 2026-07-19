import * as THREE from "three";
import type { PlayerSnapshot } from "@racing/shared";
import { animateCar, createCarMesh, disposeCarMesh } from "./car";

interface BufferedSnapshot {
  t: number; // local receive time (performance.now)
  players: Map<string, PlayerSnapshot>;
}

/** Renders other players' cars, interpolated ~130ms behind the newest snapshot. */
const RENDER_DELAY_MS = 130;

export class RemotePlayers {
  private snapshots: BufferedSnapshot[] = [];
  private meshes = new Map<string, THREE.Group>();

  constructor(
    private scene: THREE.Scene,
    private myId: string
  ) {}

  onSnapshot(players: PlayerSnapshot[]): void {
    const others = new Map(players.filter((p) => p.id !== this.myId).map((p) => [p.id, p]));
    this.snapshots.push({ t: performance.now(), players: others });
    if (this.snapshots.length > 30) this.snapshots.shift();

    // Create meshes for new players, remove ones that left.
    for (const [id, p] of others) {
      if (!this.meshes.has(id)) {
        const mesh = createCarMesh(id, p.name);
        mesh.position.set(p.x, 0, p.z);
        mesh.rotation.y = p.rot;
        this.meshes.set(id, mesh);
        this.scene.add(mesh);
      }
    }
    for (const [id, mesh] of this.meshes) {
      if (!others.has(id)) {
        disposeCarMesh(mesh);
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  update(dt: number): void {
    if (this.snapshots.length === 0) return;
    const renderT = performance.now() - RENDER_DELAY_MS;

    let older = this.snapshots[0];
    let newer = this.snapshots[this.snapshots.length - 1];
    for (let i = this.snapshots.length - 1; i > 0; i--) {
      if (this.snapshots[i - 1].t <= renderT) {
        older = this.snapshots[i - 1];
        newer = this.snapshots[i];
        break;
      }
    }
    const span = newer.t - older.t;
    const alpha = span > 0 ? Math.min(Math.max((renderT - older.t) / span, 0), 1.25) : 1;

    for (const [id, mesh] of this.meshes) {
      const a = older.players.get(id);
      const b = newer.players.get(id);
      if (!a || !b) {
        const p = b ?? a;
        if (p) {
          mesh.position.set(p.x, 0, p.z);
          mesh.rotation.y = p.rot;
          animateCar(mesh, p.speed, 0, dt);
        }
        continue;
      }
      mesh.position.set(
        a.x + (b.x - a.x) * alpha,
        0,
        a.z + (b.z - a.z) * alpha
      );
      mesh.rotation.y = lerpAngle(a.rot, b.rot, alpha);
      animateCar(mesh, a.speed + (b.speed - a.speed) * alpha, 0, dt);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      disposeCarMesh(mesh);
      this.scene.remove(mesh);
    }
    this.meshes.clear();
    this.snapshots = [];
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
