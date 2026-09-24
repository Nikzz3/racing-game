import * as THREE from "three";
import { MAX_SPEED_MS, type PlayerSnapshot, type Variant } from "@racing/shared";
import type { DirectPose, PoseSource } from "../direct-links";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import type { CarObstacle } from "./car-collision";
import { interpolateHeading } from "./pose-interpolation";

/** A remote car's reported state, at the server time it was current. */
interface Sample {
  t: number;
  /**
   * Broadcast time of the snapshot that first carried it: unlike `t`, never the
   * sender's say. A Direct Link pose has no broadcast, so it repeats `t`.
   */
  seen: number;
  x: number;
  z: number;
  rot: number;
  speed: number;
  /** Respawns so far: the server's count, or the sender's own epoch for stamped states. */
  spawns: number;
  /** The sender's pose sequence number; null for a sender predating Direct Links. */
  seq: number | null;
  /** First delivered over a Direct Link rather than relayed by the server. */
  direct: boolean;
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
  /** Newest stamped state the server relayed: Direct Link poses must stay close to it. */
  relayHead: Sample | null;
  /** Server clock minus the sender's clock, from `relayHead`: places Direct Link poses in time. */
  relayOffset: number;
  newestSeq: number;
  /** Highest seq whose first copy came over a Direct Link. */
  lastDirectSeq: number;
  /** Poses whose first copy came over a Direct Link. */
  directPoses: number;
  /** A Direct Link pose disagreed with the relayed copy of the same pose. */
  distrusted: boolean;
  /** How far behind the server clock the car is drawn (ms), eased toward its target. */
  delay: number | null;
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
/** A pose over a Direct Link skips the broadcast tick, so its car can be drawn that much sooner. */
export const DIRECT_INTERPOLATION_DELAY_MS = INTERPOLATION_DELAY_MS - 50;
/** A car's draw delay moves by at most this fraction of elapsed time, so a source change never jumps it. */
const DELAY_EASE_RATE = 0.1;
/**
 * A Direct Link carries a car while it delivered one of its newest poses first.
 * Counted in poses, not wall time, so a client drawing a few frames a second
 * (whose sends and receipts bunch up between frames) still reads its link as live.
 */
const DIRECT_SEQ_SLACK = 2;
/** How many poses a Direct Link pose may run ahead of, or behind, the newest relayed one. */
const MAX_DIRECT_LEAD_SEQ = 20;
/** Both copies of a pose carry the same doubles, so any disagreement is a forgery. */
const COPY_TOLERANCE = 1e-6;
const SAMPLE_LIMIT = 30;
/** Floor on the span a remote car's motion is judged over: states can land a few ms, or one tick, apart. */
const MIN_SOLID_SPAN_MS = 50;
/**
 * Ceiling on it: an honest sender's next state is at most two ticks behind its
 * last, so a longer gap is silence (a pause, a stall, a hostile client waiting
 * to land a far hop), not time the car spent driving.
 */
const MAX_SOLID_SPAN_MS = 100;
/** Headroom over the Room's top speed before a remote car's motion reads as a teleport; two sends can share a tick. */
const SOLID_SPEED_TOLERANCE = 2.5;
/**
 * Headroom over the top speed for how far a stamped car may be drawn from the
 * state the server last relayed. Tighter than the hop tolerance: it bounds
 * position, not a single step.
 */
const REACH_SPEED_TOLERANCE = 1.5;
/** How far past its newest state a car is extrapolated, as a fraction of the last span. */
const MAX_EXTRAPOLATION = 1.25;

/**
 * Keep samples in time order: a repeat replaces the newest (keeping when it
 * was first seen), and newer times supersede what they precede.
 */
function record(samples: Sample[], sample: Sample): void {
  while (samples.length > 0 && samples[samples.length - 1].t >= sample.t) {
    const superseded = samples.pop()!;
    if (superseded.t === sample.t) sample.seen = Math.min(sample.seen, superseded.seen);
  }
  samples.push(sample);
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}

function sameCopy(a: Sample, b: Sample): boolean {
  return (
    a.spawns === b.spawns &&
    Math.abs(a.x - b.x) <= COPY_TOLERANCE &&
    Math.abs(a.z - b.z) <= COPY_TOLERANCE &&
    Math.abs(a.rot - b.rot) <= COPY_TOLERANCE &&
    Math.abs(a.speed - b.speed) <= COPY_TOLERANCE
  );
}

/**
 * Buffer each remote car's states so it moves continuously between them. A
 * car's states arrive by up to two paths — the server relay and a Direct Link
 * (ADR-0009) — and merge into one buffer by sequence number: whichever copy
 * lands first is drawn, so a lost or failed Direct Link simply leaves the
 * relayed copies.
 */
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
      const car = this.car(player);
      const { x, z, rot, speed, stamp } = player;
      if (stamp && player.t !== undefined) {
        const sample: Sample = {
          t: player.t,
          seen: t,
          x,
          z,
          rot,
          speed,
          spawns: stamp.epoch,
          seq: stamp.seq,
          direct: false,
        };
        this.addStamped(car, sample);
        if (!car.relayHead || sample.seq! > car.relayHead.seq!) {
          car.relayHead = sample;
          car.relayOffset = player.t - stamp.sentAt;
        }
      } else {
        const sample = { t: player.t ?? t, seen: t, x, z, rot, speed, spawns: player.spawns };
        record(car.samples, { ...sample, seq: null, direct: false });
      }
    }
    for (const id of this.cars.keys()) {
      if (!present.has(id)) this.removeCar(id);
    }
  }

  /**
   * Take a pose sent over a Direct Link, placed on the server clock through the
   * sender's relayed states. A peer could send a different pose than the one it
   * reports to the server, so a pose must sit near the car's newest relayed
   * one, and a car whose two copies of any pose disagree is drawn from the
   * relay alone from then on.
   */
  onDirectPose(id: string, pose: DirectPose): void {
    const car = this.cars.get(id);
    const head = car?.relayHead;
    if (!car || !head || car.distrusted) return;
    const { seq, epoch } = pose.stamp;
    if (Math.abs(seq - head.seq!) > MAX_DIRECT_LEAD_SEQ) return;
    const t = pose.t + car.relayOffset;
    const { x, z, rot, speed } = pose;
    const sample = { t, seen: t, x, z, rot, speed, spawns: epoch, seq, direct: true };
    if (!this.addStamped(car, sample)) return;
    car.lastDirectSeq = Math.max(car.lastDirectSeq, seq);
    car.directPoses++;
  }

  /**
   * Draw every remote car as it was `INTERPOLATION_DELAY_MS` before `serverNow`,
   * or `DIRECT_INTERPOLATION_DELAY_MS` while a Direct Link carries it.
   */
  update(dt: number, serverNow: number): void {
    for (const car of this.cars.values()) {
      const { mesh, samples } = car;
      if (samples.length === 0) continue;
      const target = this.carriedDirect(car)
        ? DIRECT_INTERPOLATION_DELAY_MS
        : INTERPOLATION_DELAY_MS;
      const step = dt * 1000 * DELAY_EASE_RATE;
      car.delay =
        car.delay === null
          ? target
          : car.delay + Math.min(Math.max(target - car.delay, -step), step);
      const renderT = serverNow - car.delay;
      // The last state at or before the render time and the one after it, or
      // the first two (clamped) or the last two (extrapolated).
      let index = samples.length - 1;
      while (index > 1 && samples[index - 1].t > renderT) index--;
      const before = samples[Math.max(index - 1, 0)];
      const after = samples[index];
      const span = after.t - before.t;
      // Judged over no longer than the server saw pass between the two states,
      // so a sender cannot stretch its timestamps to pass off a teleport as
      // motion, and never over more than two ticks of silence.
      const judged = Math.min(
        Math.max(Math.min(span, after.seen - before.seen), MIN_SOLID_SPAN_MS),
        MAX_SOLID_SPAN_MS,
      );
      const maxHop = (this.topSpeed * SOLID_SPEED_TOLERANCE * judged) / 1000;
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
      // Direct Link poses reach this client before the server has seen them, so
      // a stamped car is solid only where it could have driven from the state
      // the server last relayed: a peer cannot ram with a pose it never
      // reported. The time allowed is bounded by the head's broadcast, which the
      // sender does not control.
      const head = car.relayHead;
      if (car.solid && head && after.seq !== null) {
        const elapsed = Math.max(
          Math.min(Math.abs(renderT - head.t), Math.abs(renderT - head.seen) + MAX_SOLID_SPAN_MS),
          MIN_SOLID_SPAN_MS,
        );
        const reach = (this.topSpeed * REACH_SPEED_TOLERANCE * elapsed) / 1000;
        car.solid = Math.hypot(mesh.position.x - head.x, mesh.position.z - head.z) <= reach;
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

  /** Which path each remote car's poses are currently drawn from. */
  sources(): Record<string, PoseSource> {
    return Object.fromEntries(
      [...this.cars].map(([id, car]) => [id, this.carriedDirect(car) ? "direct" : "relay"]),
    );
  }

  /** How many of each remote car's poses a Direct Link delivered before the relay did. */
  directPoses(): Record<string, number> {
    return Object.fromEntries([...this.cars].map(([id, car]) => [id, car.directPoses]));
  }

  /**
   * Where each remote car is drawn this frame, for the local car to collide with.
   * Poses are reported by other clients and passed on unchecked, so a car is only
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

  private carriedDirect(car: RemoteCar): boolean {
    return !car.distrusted && car.newestSeq - car.lastDirectSeq <= DIRECT_SEQ_SLACK;
  }

  /**
   * Buffer a stamped state in time order unless a copy of it (same seq) is
   * already held; returns whether it was taken.
   */
  private addStamped(car: RemoteCar, sample: Sample): boolean {
    const { samples } = car;
    const copy = samples.find(({ seq }) => seq === sample.seq);
    if (copy) {
      if (copy.direct === sample.direct || sameCopy(copy, sample)) return false;
      // The relayed copy is what the server saw: it replaces the forgery.
      car.distrusted = true;
      car.samples = samples.filter(({ direct }) => !direct);
      return !sample.direct && this.addStamped(car, sample);
    }
    let index = samples.length;
    while (index > 0 && samples[index - 1].t > sample.t) index--;
    if (index === 0 && samples.length >= SAMPLE_LIMIT) return false;
    samples.splice(index, 0, sample);
    if (samples.length > SAMPLE_LIMIT) samples.shift();
    car.newestSeq = Math.max(car.newestSeq, sample.seq!);
    return true;
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
    const car: RemoteCar = existing
      ? { ...existing, mesh, variant, name: player.name }
      : {
          mesh,
          variant,
          name: player.name,
          samples: [],
          speed: player.speed,
          solid: false,
          relayHead: null,
          relayOffset: 0,
          newestSeq: -Infinity,
          lastDirectSeq: -Infinity,
          directPoses: 0,
          distrusted: false,
          delay: null,
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
