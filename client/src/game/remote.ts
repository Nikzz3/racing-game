import * as THREE from "three";
import { MAX_SPEED_MS, type PlayerSnapshot, type Variant } from "@racing/shared";
import type { DirectPose, PoseSource } from "../direct-links";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import type { CarObstacle } from "./car-collision";
import { interpolateHeading } from "./pose-interpolation";

/** One pose of a remote car, from the server relay or a Direct Link. */
interface PoseSample {
  seq: number;
  /** Sender's clock (ms) for stamped poses; local arrival time for unstamped ones. */
  t: number;
  /** Local arrival time minus `t`: the path's latency plus the two clocks' offset. */
  lag: number;
  /** Respawns so far; a change between samples is a teleport. */
  epoch: number;
  x: number;
  z: number;
  rot: number;
  speed: number;
  direct: boolean;
}
interface RemoteCar {
  mesh: THREE.Group;
  variant: Variant;
  name: string;
  /** Speed as drawn this frame. */
  speed: number;
  /** Whether the local car collides with it this frame; see `obstacles()`. */
  solid: boolean;
  /** Buffered poses, ascending by `seq`. */
  samples: PoseSample[];
  /** Whether `samples` are timed by the sender's clock (stamped) or by arrival. */
  stamped: boolean;
  /** Synthetic seq for unstamped relay poses, which cannot repeat or reorder. */
  unstampedSeq: number;
  /** Newest pose the server relayed; Direct Link poses must stay close to it. */
  relayHead: PoseSample | null;
  /** How far behind now this car is drawn (ms), eased toward its target. */
  lead: number | null;
  lastDirectAt: number;
  /** A Direct Link pose disagreed with the relayed copy of the same pose. */
  distrusted: boolean;
}
export interface RemotePosition {
  id: string;
  x: number;
  z: number;
}

/**
 * Relayed poses wait for the next 50 ms server tick on top of the 50 ms send
 * interval, so they need more buffer than poses arriving over a Direct Link.
 */
const RELAY_RENDER_DELAY_MS = 130;
const DIRECT_RENDER_DELAY_MS = 80;
/** A Direct Link counts as carrying a car while its last pose is this recent. */
const DIRECT_FRESH_MS = 250;
/** A car's draw delay moves by at most this fraction of elapsed time, so a source change never jumps it. */
const LEAD_EASE_RATE = 0.1;
const SAMPLE_LIMIT = 30;
/** Poses are sent every 50 ms; how far a Direct Link pose may run ahead of the relayed one. */
const SEND_INTERVAL_MS = 50;
const MAX_DIRECT_LEAD_SEQ = 20;
const MAX_DIRECT_CLOCK_SKEW_MS = 1000;
/** Both copies of a pose carry the same doubles, so any disagreement is a forgery. */
const COPY_TOLERANCE = 1e-6;
/** Floor on the span a remote car's motion is judged over: two states can land in one 50 ms tick. */
const MIN_SOLID_SPAN_MS = 50;
/** Headroom over the Room's top speed before a remote car's motion reads as a teleport. */
const SOLID_SPEED_TOLERANCE = 2.5;

function sameCopy(a: PoseSample, b: PoseSample): boolean {
  return (
    a.t === b.t &&
    a.epoch === b.epoch &&
    Math.abs(a.x - b.x) <= COPY_TOLERANCE &&
    Math.abs(a.z - b.z) <= COPY_TOLERANCE &&
    Math.abs(a.rot - b.rot) <= COPY_TOLERANCE &&
    Math.abs(a.speed - b.speed) <= COPY_TOLERANCE
  );
}

/**
 * Buffer network updates so remote cars move continuously between them. Each
 * car's poses arrive by up to two paths — the server relay and a Direct Link —
 * and merge into one buffer by sequence number: whichever copy lands first is
 * drawn, so a lost or failed Direct Link simply leaves the relayed copies.
 */
export class RemotePlayers {
  private readonly cars = new Map<string, RemoteCar>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly myId: string,
    private readonly topSpeed = MAX_SPEED_MS.hard,
  ) {}

  onSnapshot(players: PlayerSnapshot[]): void {
    const now = performance.now();
    const others = new Map(
      players.filter((player) => player.id !== this.myId).map((player) => [player.id, player]),
    );
    for (const [id, player] of others) {
      const variant = resolveVariant(id, player.variant);
      let car = this.cars.get(id);
      if (!car) {
        car = {
          mesh: this.addMesh(player, variant),
          variant,
          name: player.name,
          speed: player.speed,
          solid: false,
          samples: [],
          stamped: false,
          unstampedSeq: 0,
          relayHead: null,
          lead: null,
          lastDirectAt: -Infinity,
          distrusted: false,
        };
        this.cars.set(id, car);
      } else if (car.variant !== variant || car.name !== player.name) {
        this.removeMesh(car.mesh);
        car.mesh = this.addMesh(player, variant);
        car.variant = variant;
        car.name = player.name;
      }
      const { stamp } = player;
      const sample: PoseSample = {
        seq: stamp ? stamp.seq : ++car.unstampedSeq,
        t: stamp ? stamp.sentAt : now,
        lag: stamp ? now - stamp.sentAt : 0,
        epoch: stamp ? stamp.epoch : player.spawns,
        x: player.x,
        z: player.z,
        rot: player.rot,
        speed: player.speed,
        direct: false,
      };
      this.addSample(car, sample, Boolean(stamp));
      if (stamp && (!car.relayHead || sample.seq > car.relayHead.seq)) car.relayHead = sample;
    }
    for (const [id, car] of this.cars) {
      if (!others.has(id)) {
        this.removeMesh(car.mesh);
        this.cars.delete(id);
      }
    }
  }

  /**
   * Take a pose sent over a Direct Link. A peer could send a different pose
   * than the one it reports to the server, so a pose must sit near the car's
   * newest relayed one, and a car whose two copies of any pose disagree is
   * drawn from the relay alone from then on.
   */
  onDirectPose(id: string, pose: DirectPose): void {
    const car = this.cars.get(id);
    const head = car?.relayHead;
    if (!car || !head || car.distrusted) return;
    const { seq, sentAt, epoch } = pose.stamp;
    const ahead = seq - head.seq;
    if (Math.abs(ahead) > MAX_DIRECT_LEAD_SEQ) return;
    if (Math.abs(sentAt - (head.t + ahead * SEND_INTERVAL_MS)) > MAX_DIRECT_CLOCK_SKEW_MS) return;
    const now = performance.now();
    car.lastDirectAt = now;
    const { x, z, rot, speed } = pose;
    this.addSample(
      car,
      { seq, t: sentAt, lag: now - sentAt, epoch, x, z, rot, speed, direct: true },
      true,
    );
  }

  update(dt: number): void {
    const now = performance.now();
    for (const car of this.cars.values()) {
      const { samples, mesh } = car;
      if (samples.length === 0) continue;
      const direct = !car.distrusted && now - car.lastDirectAt <= DIRECT_FRESH_MS;
      let offset = Infinity;
      for (const sample of samples) offset = Math.min(offset, sample.lag);
      const target = offset + (direct ? DIRECT_RENDER_DELAY_MS : RELAY_RENDER_DELAY_MS);
      const step = dt * 1000 * LEAD_EASE_RATE;
      car.lead =
        car.lead === null ? target : car.lead + Math.min(Math.max(target - car.lead, -step), step);
      const renderTime = now - car.lead;

      let before = samples[0];
      let after = samples[samples.length - 1];
      for (let index = samples.length - 1; index > 0; index--) {
        if (samples[index - 1].t <= renderTime) {
          before = samples[index - 1];
          after = samples[index];
          break;
        }
      }
      const span = after.t - before.t;
      const amount = span > 0 ? Math.min(Math.max((renderTime - before.t) / span, 0), 1.25) : 1;
      const settled = renderTime >= after.t;
      const maxHop =
        (this.topSpeed * SOLID_SPEED_TOLERANCE * Math.max(span, MIN_SOLID_SPAN_MS)) / 1000;
      // A car with a single pose has no motion to judge yet.
      car.solid =
        before !== after &&
        before.epoch === after.epoch &&
        Math.hypot(after.x - before.x, after.z - before.z) <= maxHop;
      // A respawn is a discontinuity, not a velocity to interpolate or
      // extrapolate: hold the old pose until it lands, then sit on spawn.
      const snap =
        before === after ? after : before.epoch !== after.epoch ? (settled ? after : before) : null;
      if (snap) {
        mesh.position.set(snap.x, 0, snap.z);
        mesh.rotation.y = snap.rot;
        car.speed = snap.speed;
      } else {
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

  /** Which path each remote car's poses are currently drawn from. */
  sources(): Record<string, PoseSource> {
    const now = performance.now();
    return Object.fromEntries(
      [...this.cars].map(([id, car]) => [
        id,
        !car.distrusted && now - car.lastDirectAt <= DIRECT_FRESH_MS ? "direct" : "relay",
      ]),
    );
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
    for (const car of this.cars.values()) this.removeMesh(car.mesh);
    this.cars.clear();
  }

  private addSample(car: RemoteCar, sample: PoseSample, stamped: boolean): void {
    // Stamped and unstamped times are different clocks: a driver's first
    // relayed poses predate its first state, so start over when stamps appear.
    if (car.stamped !== stamped) {
      car.samples = [];
      car.stamped = stamped;
      car.lead = null;
    }
    const { samples } = car;
    let index = samples.length;
    while (index > 0 && samples[index - 1].seq >= sample.seq) index--;
    const copy = samples[index];
    if (copy?.seq === sample.seq) {
      if (copy.direct === sample.direct || sameCopy(copy, sample)) return;
      // The relayed copy is what the server saw: it replaces the forgery.
      this.distrust(car);
      if (!sample.direct) this.addSample(car, sample, stamped);
      return;
    }
    if (index === 0 && samples.length >= SAMPLE_LIMIT) return;
    samples.splice(index, 0, sample);
    if (samples.length > SAMPLE_LIMIT) samples.shift();
  }

  private distrust(car: RemoteCar): void {
    car.distrusted = true;
    car.samples = car.samples.filter((sample) => !sample.direct);
  }

  private addMesh(player: PlayerSnapshot, variant: Variant): THREE.Group {
    const mesh = createCarMesh(player.id, player.name, variant);
    mesh.position.set(player.x, 0, player.z);
    mesh.rotation.y = player.rot;
    this.scene.add(mesh);
    return mesh;
  }

  private removeMesh(mesh: THREE.Group): void {
    disposeCarMesh(mesh);
    this.scene.remove(mesh);
  }
}
