import type { CarInput } from "./input";

/** Whatever `navigator.getGamepads()` returns: a slot per pad, null when empty. */
export type GamepadList = readonly (Gamepad | null)[];
export type GamepadSource = () => GamepadList;

/** What the connected pads ask of the car this frame. */
export interface PadInput extends CarInput {
  /** Y / Triangle is held. */
  respawn: boolean;
}

// Standard mapping (https://w3c.github.io/gamepad/#remapping).
const A = 0;
const X = 2;
const Y = 3;
const LEFT_TRIGGER = 6;
const RIGHT_TRIGGER = 7;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const LEFT_STICK_X = 0;
/** Sticks rest a little off centre, and worn ones further. */
const STICK_DEAD_ZONE = 0.15;
/** Triggers rest near 0; any residue would stop the car coasting (physics coasts only at exactly 0). */
const TRIGGER_DEAD_ZONE = 0.05;

/**
 * The browser's pads, or none where the Gamepad API is missing (jsdom, older browsers) or
 * refused: it is limited to secure contexts and throws in a frame not allowed to use it.
 */
export function browserGamepads(): GamepadList {
  try {
    return typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}

/**
 * Analog pedals and steering from every connected pad: the right trigger or A (Cross)
 * accelerates, the left trigger or X (Square) brakes, the left stick or the d-pad steers
 * and Y (Triangle) respawns. Pads add up like the keyboard and touch controls do.
 * Steering is left-positive, like CarInput. Null when no pad is connected.
 */
export function readGamepads(pads: GamepadList): PadInput | null {
  let reading: PadInput | null = null;
  for (const pad of pads) {
    if (!pad?.connected) continue;
    reading ??= { throttle: 0, brake: 0, steer: 0, respawn: false };
    reading.throttle = Math.max(
      reading.throttle,
      deadZone(value(pad, RIGHT_TRIGGER), TRIGGER_DEAD_ZONE),
      pressed(pad, A),
    );
    reading.brake = Math.max(
      reading.brake,
      deadZone(value(pad, LEFT_TRIGGER), TRIGGER_DEAD_ZONE),
      pressed(pad, X),
    );
    reading.steer +=
      pressed(pad, DPAD_LEFT) -
      pressed(pad, DPAD_RIGHT) -
      deadZone(pad.axes[LEFT_STICK_X] ?? 0, STICK_DEAD_ZONE);
    reading.respawn ||= pressed(pad, Y) === 1;
  }
  if (reading) reading.steer = Math.max(-1, Math.min(1, reading.steer));
  return reading;
}

function value(pad: Gamepad, index: number): number {
  return pad.buttons[index]?.value ?? 0;
}

function pressed(pad: Gamepad, index: number): number {
  return pad.buttons[index]?.pressed ? 1 : 0;
}

/** Zero inside the dead zone, rescaled so the rest of the travel still spans 0..1. */
function deadZone(raw: number, zone: number): number {
  const magnitude = Math.min(1, Math.abs(raw));
  return magnitude <= zone ? 0 : (Math.sign(raw) * (magnitude - zone)) / (1 - zone);
}

/** How long an off-road buzz lasts; renewed before it ends, so it reads as continuous. */
const SURFACE_PULSE_MS = 120;
const SURFACE_RENEW_MS = 100;

/**
 * Dual-rumble feedback on every connected pad that has a haptic actuator (Chromium,
 * including the desktop app; Firefox has none). A new effect replaces the one playing,
 * so a collision's jolt holds off the off-road buzz until it has finished.
 */
export class Rumble {
  private surfaceUntil = 0;
  private impactUntil = 0;

  constructor(private readonly pads: GamepadSource = browserGamepads) {}

  /** A hit, from 0 (none) to 1 (the hardest). */
  impact(level: number, now: number): void {
    if (level <= 0) return;
    const duration = 120 + 160 * level;
    this.play({ duration, strongMagnitude: 0.35 + 0.65 * level, weakMagnitude: 0.6 * level });
    this.impactUntil = now + duration;
    this.surfaceUntil = 0;
  }

  /** Called every frame: a low buzz while `level` (0..1, rough ground) is above 0. */
  surface(level: number, now: number): void {
    if (level <= 0 || now < this.impactUntil || now < this.surfaceUntil) return;
    this.play({
      duration: SURFACE_PULSE_MS,
      strongMagnitude: 0.1 + 0.25 * level,
      weakMagnitude: 0.15 + 0.35 * level,
    });
    this.surfaceUntil = now + SURFACE_RENEW_MS;
  }

  private play(effect: GamepadEffectParameters): void {
    for (const pad of this.pads()) {
      // Typed as always present, but missing outside Chromium and on pads without motors.
      const actuator = pad?.connected
        ? (pad.vibrationActuator as GamepadHapticActuator | null)
        : null;
      // Rejected while the pad is busy or the page is hidden; rumble is best effort.
      actuator?.playEffect("dual-rumble", effect).catch(() => undefined);
    }
  }
}
