// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TouchControls } from "./touch";

const NEUTRAL = { throttle: 0, brake: 0, steer: 0 };

let controls: TouchControls | undefined;
afterEach(() => {
  controls?.dispose();
  controls = undefined;
  document.body.replaceChildren();
});

interface Controls {
  gas: HTMLElement;
  brake: HTMLElement;
  steer: HTMLElement;
  knob: HTMLElement;
}

function setup({ layout = true } = {}): Controls {
  controls = new TouchControls(document.body);
  const elements = {
    gas: find(".touch-pedals > .touch-gas"),
    brake: find(".touch-pedals > .touch-brake"),
    steer: find(".touch-steer"),
    knob: find(".touch-steer > .touch-steer-knob"),
  };
  if (layout) {
    vi.spyOn(elements.steer, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 0,
      width: 200,
      height: 60,
      right: 300,
      bottom: 60,
      x: 100,
      y: 0,
      toJSON() {},
    });
  }
  return elements;
}

function find(selector: string): HTMLElement {
  return document.querySelector<HTMLElement>(selector)!;
}

function pointer(element: HTMLElement, type: string, id: number, x = 0): PointerEvent {
  const event = new PointerEvent(type, { pointerId: id, clientX: x, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

describe("touch driving controls", () => {
  it("renders the pedal buttons and steering slider", () => {
    const { gas, brake } = setup();
    expect([...document.querySelector(".touch-pedals")!.children]).toEqual([gas, brake]);
    expect(gas.getAttribute("aria-label")).toBe("Accelerate");
    expect(gas.textContent).toBe("GAS");
    expect(brake.getAttribute("aria-label")).toBe("Brake");
    expect(brake.textContent).toBe("BRAKE");
    expect((gas as HTMLButtonElement).type).toBe("button");
  });

  it("holds gas and brake independently until their pointers end", () => {
    const { gas, brake } = setup();
    expect(pointer(gas, "pointerdown", 1).defaultPrevented).toBe(true);
    expect(controls!.read()).toEqual({ throttle: 1, brake: 0, steer: 0 });
    expect(gas.classList.contains("pressed")).toBe(true);
    pointer(brake, "pointerdown", 2);
    expect(controls!.read()).toEqual({ throttle: 1, brake: 1, steer: 0 });
    pointer(gas, "pointerup", 1);
    expect(controls!.read()).toEqual({ throttle: 0, brake: 1, steer: 0 });
    expect(gas.classList.contains("pressed")).toBe(false);
    pointer(brake, "lostpointercapture", 2);
    expect(controls!.read()).toEqual(NEUTRAL);
    expect(brake.classList.contains("pressed")).toBe(false);
  });

  it("releases a pedal when its pointer is cancelled", () => {
    const { brake } = setup();
    pointer(brake, "pointerdown", 1);
    pointer(brake, "pointercancel", 1);
    expect(controls!.read()).toEqual(NEUTRAL);
  });

  it("steers left to positive and right to negative from the absolute touch position", () => {
    const { steer, knob } = setup();
    pointer(steer, "pointerdown", 1, 100);
    expect(controls!.read().steer).toBe(1);
    pointer(steer, "pointermove", 1, 400);
    expect(controls!.read().steer).toBe(-1);
    expect(knob.style.transform).toBe("translate(-50%, -50%) translateX(100px)");
    pointer(steer, "pointermove", 1, 50);
    expect(controls!.read().steer).toBe(1);
    pointer(steer, "pointermove", 1, 210);
    expect(controls!.read().steer).toBe(0);
    pointer(steer, "pointermove", 1, 150);
    expect(controls!.read().steer).toBeCloseTo((0.5 - 0.15) / 0.85);
  });

  it("springs the slider back to centre on release", () => {
    const { steer, knob } = setup();
    pointer(steer, "pointerdown", 1, 300);
    pointer(steer, "pointerup", 1, 300);
    expect(controls!.read().steer).toBe(0);
    expect(knob.style.transform).toBe("translate(-50%, -50%)");
    pointer(steer, "pointermove", 1, 100);
    expect(controls!.read().steer).toBe(0);
  });

  it("registers a held pedal and a steering pointer at the same time", () => {
    const { gas, steer } = setup();
    pointer(gas, "pointerdown", 1);
    pointer(steer, "pointerdown", 2, 100);
    expect(controls!.read()).toEqual({ throttle: 1, brake: 0, steer: 1 });
    pointer(steer, "pointerup", 2);
    expect(controls!.read()).toEqual({ throttle: 1, brake: 0, steer: 0 });
  });

  it("ignores a second pointer on a control that is already held", () => {
    const { gas, steer } = setup();
    pointer(gas, "pointerdown", 1);
    pointer(gas, "pointerdown", 2);
    pointer(gas, "pointerup", 2);
    expect(controls!.read().throttle).toBe(1);
    pointer(steer, "pointerdown", 3, 100);
    pointer(steer, "pointerdown", 4, 300);
    pointer(steer, "pointermove", 4, 300);
    pointer(steer, "pointerup", 4);
    expect(controls!.read().steer).toBe(1);
  });

  it("suppresses the long-press context menu", () => {
    const { gas, knob } = setup();
    for (const element of [gas, knob]) {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("returns to neutral when the window loses focus", () => {
    const { gas, brake, steer, knob } = setup();
    pointer(gas, "pointerdown", 1);
    pointer(brake, "pointerdown", 2);
    pointer(steer, "pointerdown", 3, 100);
    window.dispatchEvent(new Event("blur"));
    expect(controls!.read()).toEqual(NEUTRAL);
    expect(gas.classList.contains("pressed")).toBe(false);
    expect(brake.classList.contains("pressed")).toBe(false);
    expect(knob.style.transform).toBe("translate(-50%, -50%)");
    pointer(gas, "pointerdown", 4);
    expect(controls!.read().throttle).toBe(1);
  });

  it("does not steer before the slider has a layout", () => {
    const { steer } = setup({ layout: false });
    pointer(steer, "pointerdown", 1, 0);
    expect(controls!.read()).toEqual(NEUTRAL);
  });

  it("removes its DOM and stops listening when disposed", () => {
    const { gas } = setup();
    controls!.dispose();
    expect(document.querySelector(".touch-pedals, .touch-steer")).toBeNull();
    pointer(gas, "pointerdown", 1);
    expect(controls!.read()).toEqual(NEUTRAL);
  });
});
