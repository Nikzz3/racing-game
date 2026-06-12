export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
}

export class Input {
  private keys = new Set<string>();
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

  read(): CarInput {
    return {
      throttle: this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0,
      brake: this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0,
      steer:
        (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0) -
        (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0),
    };
  }
}
