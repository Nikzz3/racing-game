import type { CarInput } from "./input";

/** Drags smaller than this fraction of the ring radius are ignored. */
const DEAD_ZONE = 0.15;
/** How far the knob visually travels, as a fraction of the ring radius. */
const KNOB_TRAVEL = 0.6;

/**
 * Virtual joystick (steer left/right only) plus Gas and Brake buttons for
 * touch devices. Hidden on fine-pointer devices via CSS.
 */
export class TouchControls {
  private root: HTMLElement;
  private knob: HTMLElement;
  private gasBtn: HTMLElement;
  private brakeBtn: HTMLElement;
  private orientOverlay: HTMLElement;
  private pointerId: number | null = null;
  private x = 0; // -1..1, right positive
  private gasPressed = false;
  private brakePressed = false;

  constructor(parent: HTMLElement) {
    // Joystick (steer only)
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

    // Gas button (bottom-left)
    this.gasBtn = document.createElement("div");
    this.gasBtn.className = "gas-btn";
    parent.appendChild(this.gasBtn);

    this.gasBtn.addEventListener("pointerdown",   () => { this.gasPressed = true;  this.gasBtn.classList.add("pressed"); });
    this.gasBtn.addEventListener("pointerup",     () => { this.gasPressed = false; this.gasBtn.classList.remove("pressed"); });
    this.gasBtn.addEventListener("pointercancel", () => { this.gasPressed = false; this.gasBtn.classList.remove("pressed"); });
    this.gasBtn.addEventListener("pointerleave",  () => { this.gasPressed = false; this.gasBtn.classList.remove("pressed"); });

    // Brake button (bottom-left, right of gas)
    this.brakeBtn = document.createElement("div");
    this.brakeBtn.className = "brake-btn";
    parent.appendChild(this.brakeBtn);

    this.brakeBtn.addEventListener("pointerdown",   () => { this.brakePressed = true;  this.brakeBtn.classList.add("pressed"); });
    this.brakeBtn.addEventListener("pointerup",     () => { this.brakePressed = false; this.brakeBtn.classList.remove("pressed"); });
    this.brakeBtn.addEventListener("pointercancel", () => { this.brakePressed = false; this.brakeBtn.classList.remove("pressed"); });
    this.brakeBtn.addEventListener("pointerleave",  () => { this.brakePressed = false; this.brakeBtn.classList.remove("pressed"); });

    // Portrait-mode overlay (shown via CSS when orientation: portrait)
    this.orientOverlay = document.createElement("div");
    this.orientOverlay.className = "orient-overlay";
    this.orientOverlay.textContent = "Rotate your device";
    parent.appendChild(this.orientOverlay);
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
    this.knob.style.transform = "translate(-50%, -50%)";
  };

  private track(e: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = (e.clientX - (rect.left + radius)) / radius;
    // Horizontal-only: clamp to [-1, 1], no vertical component.
    dx = Math.max(-1, Math.min(1, dx));
    this.x = dx;
    const travel = radius * KNOB_TRAVEL;
    this.knob.style.transform =
      `translate(-50%, -50%) translate(${dx * travel}px, 0px)`;
  }

  /** Current stick input; all zeros when released. */
  read(): CarInput {
    return {
      throttle: this.gasPressed ? 1 : 0,
      brake:    this.brakePressed ? 1 : 0,
      steer:    deadZone(-this.x),
    };
  }

  dispose(): void {
    this.root.remove();
    this.gasBtn.remove();
    this.brakeBtn.remove();
    this.orientOverlay.remove();
  }
}

/** Re-scales |v| from [DEAD_ZONE, 1] to [0, 1]; values inside the zone become 0. */
function deadZone(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  return Math.sign(v) * ((a - DEAD_ZONE) / (1 - DEAD_ZONE));
}
