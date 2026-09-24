import type { CarInput } from "./input";

const DEAD_ZONE = 0.15;

/** How the on-screen controls steer: an analog slider, or two digital arrow buttons. */
export type SteeringMode = "slider" | "buttons";
export const STEERING_MODES: readonly SteeringMode[] = ["slider", "buttons"];
export const DEFAULT_STEERING: SteeringMode = "slider";

export function asSteeringMode(value: unknown): SteeringMode | null {
  return STEERING_MODES.includes(value as SteeringMode) ? (value as SteeringMode) : null;
}

/**
 * On-screen driving controls: steering bottom-left (a horizontal slider, or left and right
 * arrow buttons) and GAS and BRAKE buttons on the right. Each control captures its own
 * pointer, so one thumb can steer while the other holds a pedal. Pedals and arrows are
 * digital; the slider is analog, absolute (touching an end steers fully that way) and springs
 * back to centre on release. These are raw values: Input rate-limits the steer like the
 * keyboard's. CSS hides the controls on desktop.
 */
export class TouchControls {
  private readonly pedals = document.createElement("div");
  private readonly gas = new HoldButton("touch-pedal touch-gas", "Accelerate", "GAS");
  private readonly brake = new HoldButton("touch-pedal touch-brake", "Brake", "BRAKE");
  private readonly steering: Steering;
  private readonly listeners = new AbortController();

  constructor(parent: HTMLElement, mode: SteeringMode = DEFAULT_STEERING) {
    this.pedals.className = "touch-pedals";
    this.pedals.append(this.gas.button, this.brake.button);
    this.steering = mode === "buttons" ? new SteerArrows() : new SteerSlider();
    parent.append(this.pedals, this.steering.element);

    const { signal } = this.listeners;
    this.gas.listen(signal);
    this.brake.listen(signal);
    this.steering.listen(signal);
    for (const root of [this.pedals, this.steering.element]) {
      root.addEventListener("contextmenu", preventDefault, { signal });
    }
    window.addEventListener("blur", this.reset, { signal });
  }

  private reset = (): void => {
    this.gas.release();
    this.brake.release();
    this.steering.release();
  };

  read(): CarInput {
    return {
      throttle: this.gas.value(),
      brake: this.brake.value(),
      steer: this.steering.value(),
    };
  }

  dispose(): void {
    this.reset();
    this.listeners.abort();
    this.pedals.remove();
    this.steering.element.remove();
  }
}

const END_EVENTS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

interface Steering {
  readonly element: HTMLElement;
  listen(signal: AbortSignal): void;
  release(): void;
  /** Steer target, -1..1 with left positive. */
  value(): number;
}

/** Horizontal slider: the knob follows its one captured pointer and recentres on release. */
class SteerSlider implements Steering {
  readonly element = document.createElement("div");
  private readonly knob = document.createElement("div");
  private readonly pointer = new HeldPointer(this.element);
  private x = 0;

  constructor() {
    this.element.className = "touch-steer";
    this.element.setAttribute("aria-label", "Drag left or right to steer");
    this.knob.className = "touch-steer-knob";
    this.element.append(this.knob);
  }

  listen(signal: AbortSignal): void {
    this.element.addEventListener("pointerdown", this.onDown, { signal });
    this.element.addEventListener("pointermove", this.onMove, { signal });
    for (const type of END_EVENTS) this.element.addEventListener(type, this.onEnd, { signal });
  }

  private onDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.pointer.claim(event)) this.track(event);
  };

  private onMove = (event: PointerEvent): void => {
    if (this.pointer.owns(event)) this.track(event);
  };

  private onEnd = (event: PointerEvent): void => {
    if (this.pointer.owns(event)) this.release();
  };

  release(): void {
    this.pointer.release();
    this.x = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
  }

  private track(event: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    if (halfWidth <= 0) return;
    this.x = Math.max(-1, Math.min(1, (event.clientX - rect.left - halfWidth) / halfWidth));
    const travel = Math.max(0, halfWidth - this.knob.offsetWidth / 2);
    this.knob.style.transform = `translate(-50%, -50%) translateX(${this.x * travel}px)`;
  }

  value(): number {
    return deadZone(-this.x);
  }
}

/** Left and right arrow buttons, each holding its own pointer like the pedals. */
class SteerArrows implements Steering {
  readonly element = document.createElement("div");
  private readonly left = new HoldButton("touch-arrow touch-left", "Steer left", "‹");
  private readonly right = new HoldButton("touch-arrow touch-right", "Steer right", "›");

  constructor() {
    this.element.className = "touch-arrows";
    this.element.append(this.left.button, this.right.button);
  }

  listen(signal: AbortSignal): void {
    this.left.listen(signal);
    this.right.listen(signal);
  }

  release(): void {
    this.left.release();
    this.right.release();
  }

  /** 1 left, -1 right, 0 for neither or both. */
  value(): number {
    return this.left.value() - this.right.value();
  }
}

/** A digital button that reads 1 while its one captured pointer holds it down. */
class HoldButton {
  readonly button = document.createElement("button");
  private readonly pointer = new HeldPointer(this.button);

  constructor(className: string, label: string, text: string) {
    this.button.type = "button";
    this.button.className = className;
    this.button.setAttribute("aria-label", label);
    this.button.textContent = text;
  }

  listen(signal: AbortSignal): void {
    this.button.addEventListener("pointerdown", this.onDown, { signal });
    for (const type of END_EVENTS) this.button.addEventListener(type, this.onEnd, { signal });
  }

  private onDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.pointer.claim(event)) this.button.classList.add("pressed");
  };

  private onEnd = (event: PointerEvent): void => {
    if (this.pointer.owns(event)) this.release();
  };

  release(): void {
    this.pointer.release();
    this.button.classList.remove("pressed");
  }

  value(): number {
    return this.pointer.held() ? 1 : 0;
  }
}

/** First-pointer-wins ownership of one element, with pointer capture where available. */
class HeldPointer {
  private id: number | null = null;

  constructor(private readonly element: HTMLElement) {}

  claim(event: PointerEvent): boolean {
    if (this.id !== null) return false;
    this.id = event.pointerId;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events have no browser pointer capture.
    }
    return true;
  }

  owns(event: PointerEvent): boolean {
    return this.id !== null && event.pointerId === this.id;
  }

  held(): boolean {
    return this.id !== null;
  }

  release(): void {
    const captured = this.id;
    this.id = null;
    if (captured !== null && this.element.hasPointerCapture?.(captured)) {
      this.element.releasePointerCapture(captured);
    }
  }
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function deadZone(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude < DEAD_ZONE ? 0 : (Math.sign(value) * (magnitude - DEAD_ZONE)) / (1 - DEAD_ZONE);
}
