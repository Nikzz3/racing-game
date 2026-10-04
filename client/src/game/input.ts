import { browserGamepads, readGamepads, type GamepadSource } from "./gamepad";
import type { TouchControls } from "./touch";

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
}

const DRIVING_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "KeyR",
]);
const STEER_CHANGE_PER_SECOND = 3;

/**
 * Combines held keyboard keys, the on-screen touch pedals and steering controls, and any
 * connected gamepad.
 */
export class Input {
  private readonly keys = new Set<string>();
  private smoothSteer = 0;
  /** Whether the pads' respawn button was down on the last read: it respawns once per press. */
  private padRespawn = false;
  onRespawn: (() => void) | null = null;
  onToggleMute: (() => void) | null = null;

  constructor(
    private readonly touch: TouchControls | null = null,
    private readonly gamepads: GamepadSource = browserGamepads,
  ) {}

  private onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, [contenteditable]")
    )
      return;
    // A letter shortcut, so the key's label, not its position (unlike WASD); Cmd+M and the
    // like belong to the browser or the OS.
    const shortcut = !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat;
    if (shortcut && event.key.toLowerCase() === "m") this.onToggleMute?.();
    if (!DRIVING_KEYS.has(event.code)) return;
    event.preventDefault();
    if (event.code === "KeyR") {
      if (!event.repeat) this.onRespawn?.();
    } else {
      this.keys.add(event.code);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private reset = (): void => {
    this.keys.clear();
    this.smoothSteer = 0;
  };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.reset);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.reset);
    this.reset();
  }

  read(dt: number): CarInput {
    // Every steering source (A/D, the touch slider or arrow buttons, a pad's stick or d-pad)
    // sets one target, and the car's steer moves toward it at a fixed rate: keys and arrows
    // don't snap to full lock, and a quick thumb flick on a slider or stick eases in instead
    // of jerking the car.
    const touch = this.touch?.read();
    const pad = readGamepads(this.gamepads());
    if (pad?.respawn && !this.padRespawn) this.onRespawn?.();
    this.padRespawn = pad?.respawn ?? false;
    const keys = this.held("KeyA", "ArrowLeft") - this.held("KeyD", "ArrowRight");
    const target = Math.max(-1, Math.min(1, keys + (touch?.steer ?? 0) + (pad?.steer ?? 0)));
    const difference = target - this.smoothSteer;
    const step = STEER_CHANGE_PER_SECOND * Math.max(0, dt);
    this.smoothSteer =
      Math.abs(difference) <= step ? target : this.smoothSteer + Math.sign(difference) * step;
    return {
      throttle: Math.max(this.held("KeyW", "ArrowUp"), touch?.throttle ?? 0, pad?.throttle ?? 0),
      brake: Math.max(this.held("KeyS", "ArrowDown"), touch?.brake ?? 0, pad?.brake ?? 0),
      steer: this.smoothSteer,
    };
  }

  private held(letter: string, arrow: string): number {
    return this.keys.has(letter) || this.keys.has(arrow) ? 1 : 0;
  }
}
