import * as THREE from "three";
import {
  DEFAULT_DIFFICULTY,
  MAX_SPEED_MS,
  type Difficulty,
  type PlayerSnapshot,
  type Variant,
} from "@racing/shared";
import {
  animateCar,
  createCarMesh,
  disposeCarMesh,
  resolveVariant,
} from "./car";
import { interpolateHeading } from "./pose-interpolation";

interface BufferedSnapshot {
  receivedAt: number;
  players: Map<string, PlayerSnapshot>;
}
interface RemoteCar {
  mesh: THREE.Group;
  variant: Variant;
  name: string;
}
const RENDER_DELAY_MS = 130;
const SNAPSHOT_LIMIT = 30;

/** Buffer network updates so remote cars move continuously between snapshots. */
export class RemotePlayers {
  private snapshots: BufferedSnapshot[] = [];
  private readonly cars = new Map<string, RemoteCar>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly myId: string,
    private readonly difficulty: Difficulty = DEFAULT_DIFFICULTY,
  ) {}

  onSnapshot(players: PlayerSnapshot[]): void {
    const others = new Map(
      players
        .filter((player) => player.id !== this.myId)
        .map((player) => [player.id, player]),
    );
    this.snapshots.push({ receivedAt: performance.now(), players: others });
    if (this.snapshots.length > SNAPSHOT_LIMIT) this.snapshots.shift();

    for (const [id, player] of others) {
      const variant = resolveVariant(id, player.variant);
      const existing = this.cars.get(id);
      if (existing) {
        if (existing.variant === variant && existing.name === player.name)
          continue;
        this.removeCar(id);
      }
      const mesh = createCarMesh(id, player.name, variant);
      mesh.position.set(player.x, 0, player.z);
      mesh.rotation.y = player.rot;
      this.cars.set(id, { mesh, variant, name: player.name });
      this.scene.add(mesh);
    }
    for (const id of this.cars.keys()) {
      if (!others.has(id)) this.removeCar(id);
    }
  }

  update(dt: number): void {
    if (this.snapshots.length === 0) return;
    const renderTime = performance.now() - RENDER_DELAY_MS;
    let older = this.snapshots[0];
    let newer = this.snapshots[this.snapshots.length - 1];
    for (let index = this.snapshots.length - 1; index > 0; index--) {
      if (this.snapshots[index - 1].receivedAt <= renderTime) {
        older = this.snapshots[index - 1];
        newer = this.snapshots[index];
        break;
      }
    }
    const span = newer.receivedAt - older.receivedAt;
    const amount =
      span > 0
        ? Math.min(Math.max((renderTime - older.receivedAt) / span, 0), 1.25)
        : 1;
    // A respawn is a discontinuity, not a velocity to interpolate or
    // extrapolate. Allow a buffer's worth of network jitter at top speed.
    const maxDistance =
      (MAX_SPEED_MS[this.difficulty] * (span + RENDER_DELAY_MS)) / 1000;
    const maxDistanceSq = maxDistance * maxDistance;
    const settled = renderTime >= newer.receivedAt;
    for (const [id, { mesh }] of this.cars) {
      const before = older.players.get(id);
      const after = newer.players.get(id);
      let snap = after ?? before;
      if (before && after) {
        const dx = after.x - before.x;
        const dz = after.z - before.z;
        snap =
          dx * dx + dz * dz > maxDistanceSq
            ? settled
              ? after
              : before
            : undefined;
      }
      if (snap) {
        mesh.position.set(snap.x, 0, snap.z);
        mesh.rotation.y = snap.rot;
        animateCar(mesh, snap.speed, 0, dt);
      } else if (before && after) {
        mesh.position.set(
          before.x + (after.x - before.x) * amount,
          0,
          before.z + (after.z - before.z) * amount,
        );
        mesh.rotation.y = interpolateHeading(before.rot, after.rot, amount);
        animateCar(
          mesh,
          before.speed + (after.speed - before.speed) * amount,
          0,
          dt,
        );
      }
    }
  }

  playerIds(): string[] {
    return [...this.cars.keys()];
  }

  resolvedVariants(): Record<string, Variant> {
    return Object.fromEntries(
      [...this.cars].map(([id, car]) => [id, car.variant]),
    );
  }

  dispose(): void {
    for (const id of this.cars.keys()) this.removeCar(id);
    this.snapshots = [];
  }

  private removeCar(id: string): void {
    const car = this.cars.get(id);
    if (!car) return;
    disposeCarMesh(car.mesh);
    this.scene.remove(car.mesh);
    this.cars.delete(id);
  }
}
