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

/** Combines held keyboard keys with the analog touch joystick. */
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
    const target = this.held("KeyA", "ArrowLeft") - this.held("KeyD", "ArrowRight");
    const difference = target - this.smoothSteer;
    const step = STEER_CHANGE_PER_SECOND * Math.max(0, dt);
    this.smoothSteer =
      Math.abs(difference) <= step ? target : this.smoothSteer + Math.sign(difference) * step;
    const touch = this.touch?.read();
    return {
      throttle: Math.max(this.held("KeyW", "ArrowUp"), touch?.throttle ?? 0),
      brake: Math.max(this.held("KeyS", "ArrowDown"), touch?.brake ?? 0),
      steer: Math.max(-1, Math.min(1, this.smoothSteer + (touch?.steer ?? 0))),
    };
  }

  private held(letter: string, arrow: string): number {
    return this.keys.has(letter) || this.keys.has(arrow) ? 1 : 0;
  }
}
