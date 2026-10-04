import { STEER_RATE, steeringGrip } from "@racing/shared";

export const IDLE_RPM = 900;
export const REDLINE_RPM = 7200;
/**
 * Where each gear runs out, as a share of the car's top speed. The top gear tops out
 * short of the redline, so cruising flat out doesn't sound like the limiter.
 */
const GEAR_TOPS = [0.24, 0.42, 0.6, 0.8, 1.08];
/** Shift up at this share of the redline… */
const UPSHIFT = 0.96;
/** …and down once the gear below would turn slower than this share. */
const DOWNSHIFT = 0.7;
/** How far the throttle revs a slipping clutch in first gear, as a share of the rev range. */
const LAUNCH_REV = 0.45;
/** Engine inertia: the time constant (s) the revs follow the gearing with, and the load the pedal. */
const REV_TIME = 0.07;
const LOAD_TIME = 0.08;

/**
 * The engine a car's sound is drawn from: a five-speed gearbox turning road speed into
 * revs, with a little inertia so shifts drop the note quickly but not instantly.
 */
export class Engine {
  rpm = IDLE_RPM;
  /** How hard the engine is pulling: 0 coasting to 1 at full throttle, smoothed. */
  load = 0;
  /** 0 is first gear (and reverse). */
  gear = 0;

  /** `topSpeed` is the car's real top speed, in m/s: the top gear is geared to it. */
  constructor(private readonly topSpeed: number) {}

  update(dt: number, speed: number, throttle: number): void {
    const speedShare = Math.abs(speed) / Math.max(1, this.topSpeed);
    const geared = (gear: number) => (REDLINE_RPM * speedShare) / GEAR_TOPS[gear];
    while (this.gear < GEAR_TOPS.length - 1 && geared(this.gear) > UPSHIFT * REDLINE_RPM)
      this.gear++;
    while (this.gear > 0 && geared(this.gear - 1) < DOWNSHIFT * REDLINE_RPM) this.gear--;
    let target = Math.max(IDLE_RPM, geared(this.gear));
    // Pulling away, the clutch slips and the throttle revs the engine ahead of the wheels.
    if (this.gear === 0)
      target = Math.max(target, IDLE_RPM + throttle * LAUNCH_REV * (REDLINE_RPM - IDLE_RPM));
    this.rpm = approach(this.rpm, Math.min(target, REDLINE_RPM), dt, REV_TIME);
    this.load = approach(this.load, throttle, dt, LOAD_TIME);
  }
}

/**
 * How loud each engine loop plays at `rpm`, given the revs each was built at (ascending):
 * the two either side of `rpm` crossfade at equal power, by how far apart in pitch it sits
 * between them, and the rest are silent. Outside the range the nearest loop plays alone.
 */
export function engineLoopLevels(rpm: number, loopRpms: readonly number[]): number[] {
  const levels = loopRpms.map(() => 0);
  const last = loopRpms.length - 1;
  if (rpm <= loopRpms[0] || rpm >= loopRpms[last]) {
    levels[rpm <= loopRpms[0] ? 0 : last] = 1;
    return levels;
  }
  let upper = 1;
  while (loopRpms[upper] < rpm) upper++;
  const lower = loopRpms[upper - 1];
  const amount = Math.log(rpm / lower) / Math.log(loopRpms[upper] / lower);
  levels[upper - 1] = Math.cos((amount * Math.PI) / 2);
  levels[upper] = Math.sin((amount * Math.PI) / 2);
  return levels;
}

/** Exponential smoothing toward `target` with time constant `time` (s), whatever the frame rate. */
export function approach(value: number, target: number, dt: number, time: number): number {
  return target + (value - target) * Math.exp(-Math.max(0, dt) / time);
}

/**
 * How hard another car's driver seems to be pressing the throttle, judged by how its speed
 * changes (its client never says): about a third holding speed, full when pulling hard,
 * none when slowing down.
 */
export function apparentThrottle(previousSpeed: number, speed: number, dt: number): number {
  if (dt <= 0 || Math.abs(speed) < 0.5) return 0;
  const acceleration = (Math.abs(speed) - Math.abs(previousSpeed)) / dt;
  return clamp01(0.3 + acceleration / 25);
}

/** Cornering (m/s²) where the tyres start to squeal, and where they're at their loudest. */
const SQUEAL_FROM = 18;
const SQUEAL_FULL = 45;

/**
 * Tyre squeal, 0..1, from how hard the car is cornering: speed times the turn rate the
 * steering gets at that speed. The car has no slip model, so this is the sound of the
 * lateral load rather than of a slide. Grass doesn't squeal.
 */
export function squealLevel(speed: number, steer: number, onTrack: boolean): number {
  if (!onTrack) return 0;
  const cornering = Math.abs(speed * steer * STEER_RATE * steeringGrip(speed));
  return smoothstep((cornering - SQUEAL_FROM) / (SQUEAL_FULL - SQUEAL_FROM));
}

/** How rough the ground under the car is, 0..1: nothing on the road, more the faster it crosses grass. */
export function roughness(speed: number, onTrack: boolean): number {
  return onTrack ? 0 : clamp01((Math.abs(speed) - 1) / 8);
}

/** How hard a hit felt, 0..1, from the speed it cost (`CarPhysics.takeImpact`); nudges don't count. */
export function impactLevel(impact: number): number {
  return clamp01((impact - 1.5) / 16);
}

/** Where sound is heard from: the camera, on the ground plane. */
export interface Listener {
  x: number;
  z: number;
  /** Unit vector the camera faces along. */
  forwardX: number;
  forwardZ: number;
}

/** Within this distance (m) another car is heard at its full level; past it, inversely with distance. */
const FULL_LEVEL_DISTANCE = 12;

/**
 * How another car at (x, z) is heard: its distance, its stereo position (-1 left to 1 right)
 * and the level distance leaves it.
 */
export function hearing(
  listener: Listener,
  x: number,
  z: number,
): { distance: number; pan: number; level: number } {
  const dx = x - listener.x;
  const dz = z - listener.z;
  const distance = Math.hypot(dx, dz);
  // Right of the camera is forward × up: (-forwardZ, forwardX) on the ground. Panning stops
  // short of hard left or right, where the other ear would hear nothing at all.
  const right = dz * listener.forwardX - dx * listener.forwardZ;
  const pan = distance > 1e-6 ? 0.85 * Math.max(-1, Math.min(1, right / distance)) : 0;
  return { distance, pan, level: FULL_LEVEL_DISTANCE / Math.max(FULL_LEVEL_DISTANCE, distance) };
}

const SPEED_OF_SOUND = 343;
/** Real Doppler at these closing speeds bends the note by several semitones; half of it still reads as speed. */
const DOPPLER_SCALE = 0.5;

/** Pitch factor for a car moving away from the listener at `recedingSpeed` m/s (negative: closing in). */
export function dopplerShift(recedingSpeed: number): number {
  return SPEED_OF_SOUND / (SPEED_OF_SOUND + DOPPLER_SCALE * recedingSpeed);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(amount: number): number {
  const t = clamp01(amount);
  return t * t * (3 - 2 * t);
}
