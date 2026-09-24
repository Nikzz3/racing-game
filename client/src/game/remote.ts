import * as THREE from "three";
import { MAX_SPEED_MS, type PlayerSnapshot, type Variant } from "@racing/shared";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import type { CarObstacle } from "./car-collision";
import { interpolateHeading } from "./pose-interpolation";

/** A remote car's reported state, at the server time it was current. */
interface Sample {
  t: number;
  x: number;
  z: number;
  rot: number;
  speed: number;
  spawns: number;
}
interface RemoteCar {
  mesh: THREE.Group;
  variant: Variant;
  name: string;
  /** Distinct states in time order. */
  samples: Sample[];
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
/**
 * How far behind the server clock remote cars are drawn. The state after the
 * newest one held can be a send interval (50 ms) away, waits up to a broadcast
 * tick (50 ms) on the server, and carries a pose up to a render frame (17 ms)
 * older than its send; the rest absorbs network jitter and coarse timers. A
 * state later than that is briefly extrapolated, then held.
 */
export const INTERPOLATION_DELAY_MS = 150;
const SAMPLE_LIMIT = 30;
/** Floor on the span a remote car's motion is judged over: a sender stamped on arrival can land two states a few ms apart. */
const MIN_SOLID_SPAN_MS = 50;
/** Headroom over the Room's top speed before a remote car's motion reads as a teleport. */
const SOLID_SPEED_TOLERANCE = 2.5;
/** How far past its newest state a car is extrapolated, as a fraction of the last span. */
const MAX_EXTRAPOLATION = 1.25;

/** Keep samples in time order: a repeat replaces the newest, and newer times supersede what they precede. */
function record(samples: Sample[], sample: Sample): void {
  while (samples.length > 0 && samples[samples.length - 1].t >= sample.t) samples.pop();
  samples.push(sample);
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}

/** Buffer each remote car's states so it moves continuously between them. */
export class RemotePlayers {
  private readonly cars = new Map<string, RemoteCar>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly myId: string,
    private readonly topSpeed = MAX_SPEED_MS.hard,
  ) {}

  /**
   * Take in a snapshot broadcast at server time `t`. Each player's state is
   * placed at its own time (`PlayerSnapshot.t`), or at `t` from a server that
   * does not send one.
   */
  onSnapshot(players: PlayerSnapshot[], t: number): void {
    const present = new Set<string>();
    for (const player of players) {
      if (player.id === this.myId) continue;
      present.add(player.id);
      const { x, z, rot, speed, spawns } = player;
      record(this.car(player).samples, { t: player.t ?? t, x, z, rot, speed, spawns });
    }
    for (const id of this.cars.keys()) {
      if (!present.has(id)) this.removeCar(id);
    }
  }

  /** Draw every remote car as it was `INTERPOLATION_DELAY_MS` before `serverNow`. */
  update(dt: number, serverNow: number): void {
    const renderT = serverNow - INTERPOLATION_DELAY_MS;
    for (const car of this.cars.values()) {
      const { mesh, samples } = car;
      // The last state at or before the render time and the one after it, or
      // the first two (clamped) or the last two (extrapolated).
      let index = samples.length - 1;
      while (index > 1 && samples[index - 1].t > renderT) index--;
      const before = samples[Math.max(index - 1, 0)];
      const after = samples[index];
      const span = after.t - before.t;
      const maxHop =
        (this.topSpeed * SOLID_SPEED_TOLERANCE * Math.max(span, MIN_SOLID_SPAN_MS)) / 1000;
      car.solid =
        before !== after &&
        before.spawns === after.spawns &&
        Math.hypot(after.x - before.x, after.z - before.z) <= maxHop;
      if (span <= 0 || before.spawns !== after.spawns) {
        // A respawn is a discontinuity, not a velocity to interpolate or
        // extrapolate: hold the old pose until it lands, then sit on spawn.
        const snap = renderT >= after.t ? after : before;
        mesh.position.set(snap.x, 0, snap.z);
        mesh.rotation.y = snap.rot;
        car.speed = snap.speed;
      } else {
        const amount = Math.min(Math.max((renderT - before.t) / span, 0), MAX_EXTRAPOLATION);
        mesh.position.set(
          before.x + (after.x - before.x) * amount,
          0,
          before.z + (after.z - before.z) * amount,
        );
        mesh.rotation.y = interpolateHeading(before.rot, after.rot, amount);
        car.speed = before.speed + (after.speed - before.speed) * amount;
      }
      animateCar(mesh, car.speed, 0, dt);
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
  }

  /** The player's car, (re)built when it is new or its name or Variant changed; its states carry over. */
  private car(player: PlayerSnapshot): RemoteCar {
    const variant = resolveVariant(player.id, player.variant);
    const existing = this.cars.get(player.id);
    if (existing?.variant === variant && existing.name === player.name) return existing;
    if (existing) this.removeCar(player.id);
    const mesh = createCarMesh(player.id, player.name, variant);
    mesh.position.set(player.x, 0, player.z);
    mesh.rotation.y = player.rot;
    const car: RemoteCar = {
      mesh,
      variant,
      name: player.name,
      samples: existing?.samples ?? [],
      speed: player.speed,
      solid: false,
    };
    this.cars.set(player.id, car);
    this.scene.add(mesh);
    return car;
  }

  private removeCar(id: string): void {
    const car = this.cars.get(id);
    if (!car) return;
    disposeCarMesh(car.mesh);
    this.scene.remove(car.mesh);
    this.cars.delete(id);
  }
}
