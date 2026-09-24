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

/** Combines held keyboard keys with the on-screen touch pedals and steering controls. */
export class Input {
  private readonly keys = new Set<string>();
  private smoothSteer = 0;
  onRespawn: (() => void) | null = null;

  constructor(private readonly touch: TouchControls | null = null) {}

  private onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, [contenteditable]")
    )
      return;
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
    // Every steering source (A/D, the touch slider or arrow buttons) sets one target, and the
    // car's steer moves toward it at a fixed rate: keys and arrows don't snap to full lock,
    // and a quick thumb flick on the slider eases in instead of jerking the car.
    const touch = this.touch?.read();
    const keys = this.held("KeyA", "ArrowLeft") - this.held("KeyD", "ArrowRight");
    const target = Math.max(-1, Math.min(1, keys + (touch?.steer ?? 0)));
    const difference = target - this.smoothSteer;
    const step = STEER_CHANGE_PER_SECOND * Math.max(0, dt);
    this.smoothSteer =
      Math.abs(difference) <= step ? target : this.smoothSteer + Math.sign(difference) * step;
    return {
      throttle: Math.max(this.held("KeyW", "ArrowUp"), touch?.throttle ?? 0),
      brake: Math.max(this.held("KeyS", "ArrowDown"), touch?.brake ?? 0),
      steer: this.smoothSteer,
    };
  }

  private held(letter: string, arrow: string): number {
    return this.keys.has(letter) || this.keys.has(arrow) ? 1 : 0;
  }
}
