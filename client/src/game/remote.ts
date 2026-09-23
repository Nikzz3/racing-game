import * as THREE from "three";
import { MAX_SPEED_MS, type PlayerSnapshot, type Variant } from "@racing/shared";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import type { CarObstacle } from "./car-collision";
import { interpolateHeading } from "./pose-interpolation";

interface BufferedSnapshot {
  receivedAt: number;
  players: Map<string, PlayerSnapshot>;
}
interface RemoteCar {
  mesh: THREE.Group;
  variant: Variant;
  name: string;
  /** Speed as drawn this frame. */
  speed: number;
  /** Whether the local car collides with it this frame; see `obstacles()`. */
  solid: boolean;
}
export interface RemotePosition {
  id: string;
  x: number;
  z: number;
}
const RENDER_DELAY_MS = 130;
const SNAPSHOT_LIMIT = 30;
/** Floor on the span a remote car's motion is judged over: two states can land in one 50 ms tick. */
const MIN_SOLID_SPAN_MS = 50;
/** Headroom over the Room's top speed before a remote car's motion reads as a teleport. */
const SOLID_SPEED_TOLERANCE = 2.5;

/** Buffer network updates so remote cars move continuously between snapshots. */
export class RemotePlayers {
  private snapshots: BufferedSnapshot[] = [];
  private readonly cars = new Map<string, RemoteCar>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly myId: string,
    private readonly topSpeed = MAX_SPEED_MS.hard,
  ) {}

  onSnapshot(players: PlayerSnapshot[]): void {
    const others = new Map(
      players.filter((player) => player.id !== this.myId).map((player) => [player.id, player]),
    );
    this.snapshots.push({ receivedAt: performance.now(), players: others });
    if (this.snapshots.length > SNAPSHOT_LIMIT) this.snapshots.shift();

    for (const [id, player] of others) {
      const variant = resolveVariant(id, player.variant);
      const existing = this.cars.get(id);
      if (existing) {
        if (existing.variant === variant && existing.name === player.name) continue;
        this.removeCar(id);
      }
      const mesh = createCarMesh(id, player.name, variant);
      mesh.position.set(player.x, 0, player.z);
      mesh.rotation.y = player.rot;
      this.cars.set(id, { mesh, variant, name: player.name, speed: player.speed, solid: false });
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
      span > 0 ? Math.min(Math.max((renderTime - older.receivedAt) / span, 0), 1.25) : 1;
    const settled = renderTime >= newer.receivedAt;
    const maxHop =
      (this.topSpeed * SOLID_SPEED_TOLERANCE * Math.max(span, MIN_SOLID_SPAN_MS)) / 1000;
    for (const [id, car] of this.cars) {
      const { mesh } = car;
      const before = older.players.get(id);
      const after = newer.players.get(id);
      let snap = after ?? before;
      car.solid = Boolean(
        before &&
        after &&
        before.spawns === after.spawns &&
        Math.hypot(after.x - before.x, after.z - before.z) <= maxHop,
      );
      if (before && after) {
        // A respawn is a discontinuity, not a velocity to interpolate or
        // extrapolate: hold the old pose until it lands, then sit on spawn.
        const teleported = before.spawns !== after.spawns;
        snap = teleported ? (settled ? after : before) : undefined;
      }
      if (snap) {
        mesh.position.set(snap.x, 0, snap.z);
        mesh.rotation.y = snap.rot;
        car.speed = snap.speed;
        animateCar(mesh, car.speed, 0, dt);
      } else if (before && after) {
        mesh.position.set(
          before.x + (after.x - before.x) * amount,
          0,
          before.z + (after.z - before.z) * amount,
        );
        mesh.rotation.y = interpolateHeading(before.rot, after.rot, amount);
        car.speed = before.speed + (after.speed - before.speed) * amount;
        animateCar(mesh, car.speed, 0, dt);
      }
    }
  }

  /** Where each remote car is drawn this frame, after interpolation. */
  positions(): RemotePosition[] {
    return [...this.cars].map(([id, { mesh }]) => ({
      id,
      x: mesh.position.x,
      z: mesh.position.z,
    }));
  }

  /**
   * Where each remote car is drawn this frame, for the local car to collide with.
   * Poses are reported by other clients and relayed unchecked, so a car is only
   * solid while its drawn motion is one a car could make in this Room: a
   * teleport — a respawn, a player just joining from the origin, or a forged
   * position — passes through instead of shoving the local car.
   */
  obstacles(): CarObstacle[] {
    return [...this.cars].flatMap(([id, { mesh, speed, solid }]) =>
      solid
        ? [
            {
              x: mesh.position.x,
              z: mesh.position.z,
              heading: mesh.rotation.y,
              speed,
              side: id < this.myId ? (1 as const) : (-1 as const),
            },
          ]
        : [],
    );
  }

  resolvedVariants(): Record<string, Variant> {
    return Object.fromEntries([...this.cars].map(([id, car]) => [id, car.variant]));
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
