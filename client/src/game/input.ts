import type { TouchControls } from "./touch";

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
}

export class Input {
  private keys = new Set<string>();
  private smoothSteer = 0;

  constructor(private touch: TouchControls | null = null) {}

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.keys.clear();
  }

  read(dt: number): CarInput {
    const targetSteer =
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0) -
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0);
    const diff = targetSteer - this.smoothSteer;
    const step = 3.0 * dt;
    this.smoothSteer =
      Math.abs(diff) <= step ? targetSteer : this.smoothSteer + Math.sign(diff) * step;
    const kb: CarInput = {
      throttle: this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0,
      brake: this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0,
      steer: this.smoothSteer,
    };
    const t = this.touch?.read();
    if (!t) return kb;
    // Joystick steer is already analog, so it skips the keyboard smoothing.
    return {
      throttle: Math.max(kb.throttle, t.throttle),
      brake: Math.max(kb.brake, t.brake),
      steer: Math.max(-1, Math.min(1, kb.steer + t.steer)),
    };
  }
}
