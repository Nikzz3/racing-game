import type { CarInput } from "./input";

const DEAD_ZONE = 0.15;
const KNOB_TRAVEL = 0.6;

/** One captured pointer controls steering and pedals; CSS hides it on desktop. */
export class TouchControls {
  private readonly root = document.createElement("div");
  private readonly knob = document.createElement("div");
  private pointerId: number | null = null;
  private x = 0;
  private y = 0;

  constructor(parent: HTMLElement) {
    this.root.className = "joystick";
    this.root.setAttribute("aria-label", "Drag to steer, accelerate or brake");
    this.knob.className = "joystick-knob";
    this.root.append(this.knob);
    parent.append(this.root);
    this.root.addEventListener("pointerdown", this.onDown);
    this.root.addEventListener("pointermove", this.onMove);
    this.root.addEventListener("pointerup", this.onEnd);
    this.root.addEventListener("pointercancel", this.onEnd);
    this.root.addEventListener("lostpointercapture", this.onEnd);
    window.addEventListener("blur", this.reset);
  }

  private onDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events have no browser pointer capture.
    }
    this.track(event);
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.track(event);
  };

  private onEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.reset();
  };

  private reset = (): void => {
    const capturedPointer = this.pointerId;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
    if (
      capturedPointer !== null &&
      this.root.hasPointerCapture?.(capturedPointer)
    ) {
      this.root.releasePointerCapture(capturedPointer);
    }
  };

  private track(event: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const radius = rect.width / 2;
    if (radius <= 0) return;
    const horizontal = (event.clientX - rect.left - radius) / radius;
    const vertical = (event.clientY - rect.top - rect.height / 2) / radius;
    const magnitude = Math.max(1, Math.hypot(horizontal, vertical));
    this.x = horizontal / magnitude;
    this.y = vertical / magnitude;
    const travel = radius * KNOB_TRAVEL;
    this.knob.style.transform = `translate(-50%, -50%) translate(${this.x * travel}px, ${this.y * travel}px)`;
  }

  read(): CarInput {
    return {
      throttle: deadZone(Math.max(0, -this.y)),
      brake: deadZone(Math.max(0, this.y)),
      steer: deadZone(-this.x),
    };
  }

  dispose(): void {
    this.reset();
    window.removeEventListener("blur", this.reset);
    this.root.removeEventListener("pointerdown", this.onDown);
    this.root.removeEventListener("pointermove", this.onMove);
    this.root.removeEventListener("pointerup", this.onEnd);
    this.root.removeEventListener("pointercancel", this.onEnd);
    this.root.removeEventListener("lostpointercapture", this.onEnd);
    this.root.remove();
  }
}

function deadZone(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude < DEAD_ZONE
    ? 0
    : (Math.sign(value) * (magnitude - DEAD_ZONE)) / (1 - DEAD_ZONE);
}
