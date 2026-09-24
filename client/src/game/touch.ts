import type { CarInput } from "./input";

const DEAD_ZONE = 0.15;

/**
 * On-screen driving controls: a horizontal steering slider on the left and GAS and BRAKE
 * buttons on the right. Each control captures its own pointer, so one thumb can steer while
 * the other holds a pedal. Pedals are digital; the slider is analog, absolute (touching an end
 * steers fully that way) and springs back to centre on release. CSS hides them on desktop.
 */
export class TouchControls {
  private readonly pedals = document.createElement("div");
  private readonly gas = new Pedal("touch-gas", "Accelerate", "GAS");
  private readonly brake = new Pedal("touch-brake", "Brake", "BRAKE");
  private readonly steer = document.createElement("div");
  private readonly knob = document.createElement("div");
  private readonly steerPointer = new HeldPointer(this.steer);
  private readonly listeners = new AbortController();
  private x = 0;

  constructor(parent: HTMLElement) {
    this.pedals.className = "touch-pedals";
    this.pedals.append(this.gas.button, this.brake.button);
    this.steer.className = "touch-steer";
    this.steer.setAttribute("aria-label", "Drag left or right to steer");
    this.knob.className = "touch-steer-knob";
    this.steer.append(this.knob);
    parent.append(this.pedals, this.steer);

    const { signal } = this.listeners;
    this.gas.listen(signal);
    this.brake.listen(signal);
    this.steer.addEventListener("pointerdown", this.onSteerDown, { signal });
    this.steer.addEventListener("pointermove", this.onSteerMove, { signal });
    for (const type of END_EVENTS) this.steer.addEventListener(type, this.onSteerEnd, { signal });
    for (const root of [this.pedals, this.steer]) {
      root.addEventListener("contextmenu", preventDefault, { signal });
    }
    window.addEventListener("blur", this.reset, { signal });
  }

  private onSteerDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.steerPointer.claim(event)) this.track(event);
  };

  private onSteerMove = (event: PointerEvent): void => {
    if (this.steerPointer.owns(event)) this.track(event);
  };

  private onSteerEnd = (event: PointerEvent): void => {
    if (this.steerPointer.owns(event)) this.recenter();
  };

  private reset = (): void => {
    this.gas.release();
    this.brake.release();
    this.recenter();
  };

  private recenter(): void {
    this.steerPointer.release();
    this.x = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
  }

  private track(event: PointerEvent): void {
    const rect = this.steer.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    if (halfWidth <= 0) return;
    this.x = Math.max(-1, Math.min(1, (event.clientX - rect.left - halfWidth) / halfWidth));
    const travel = Math.max(0, halfWidth - this.knob.offsetWidth / 2);
    this.knob.style.transform = `translate(-50%, -50%) translateX(${this.x * travel}px)`;
  }

  read(): CarInput {
    return {
      throttle: this.gas.value(),
      brake: this.brake.value(),
      steer: deadZone(-this.x),
    };
  }

  dispose(): void {
    this.reset();
    this.listeners.abort();
    this.pedals.remove();
    this.steer.remove();
  }
}

const END_EVENTS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

/** A digital button that reads 1 while its one captured pointer holds it down. */
class Pedal {
  readonly button = document.createElement("button");
  private readonly pointer = new HeldPointer(this.button);

  constructor(className: string, label: string, text: string) {
    this.button.type = "button";
    this.button.className = `touch-pedal ${className}`;
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
