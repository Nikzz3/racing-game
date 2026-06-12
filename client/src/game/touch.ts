import type { CarInput } from "./input";

/** Drags smaller than this fraction of the ring radius are ignored. */
const DEAD_ZONE = 0.15;
/** How far the knob visually travels, as a fraction of the ring radius. */
const KNOB_TRAVEL = 0.6;

/**
 * Virtual joystick for touch devices. Drag up = throttle, down = brake,
 * left/right = steer. Hidden on fine-pointer devices via CSS.
 */
export class TouchControls {
  private root: HTMLElement;
  private knob: HTMLElement;
  private pointerId: number | null = null;
  private x = 0; // -1..1, right positive
  private y = 0; // -1..1, down positive

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "joystick";
    this.knob = document.createElement("div");
    this.knob.className = "joystick-knob";
    this.root.appendChild(this.knob);
    parent.appendChild(this.root);

    this.root.addEventListener("pointerdown", this.onDown);
    this.root.addEventListener("pointermove", this.onMove);
    this.root.addEventListener("pointerup", this.onEnd);
    this.root.addEventListener("pointercancel", this.onEnd);
  }

  private onDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no active pointer to capture; dragging still works.
    }
    this.track(e);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.track(e);
  };

  private onEnd = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
  };

  private track(e: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = (e.clientX - (rect.left + radius)) / radius;
    let dy = (e.clientY - (rect.top + radius)) / radius;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    this.x = dx;
    this.y = dy;
    const travel = radius * KNOB_TRAVEL;
    this.knob.style.transform =
      `translate(-50%, -50%) translate(${dx * travel}px, ${dy * travel}px)`;
  }

  /** Current stick input; all zeros when released. */
  read(): CarInput {
    return {
      throttle: deadZone(Math.max(0, -this.y)),
      brake: deadZone(Math.max(0, this.y)),
      // Drag left = steer left (+1), matching the KeyA/ArrowLeft mapping.
      steer: deadZone(-this.x),
    };
  }

  dispose(): void {
    this.root.remove();
  }
}

/** Re-scales |v| from [DEAD_ZONE, 1] to [0, 1]; values inside the zone become 0. */
function deadZone(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  return Math.sign(v) * ((a - DEAD_ZONE) / (1 - DEAD_ZONE));
}
