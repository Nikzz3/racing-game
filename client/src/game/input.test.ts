// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./input";
import { TouchControls } from "./touch";

const controls: Input[] = [];
const touches: TouchControls[] = [];
function input(touch: TouchControls | null = null): Input {
  const control = new Input(touch);
  control.attach();
  controls.push(control);
  return control;
}
function key(code: string, repeat = false, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, repeat, bubbles: true }));
}
/** Dispatches a pointer event on the first element matching `selector`. */
function hold(selector: string, id: number, type = "pointerdown", x = 0): void {
  document
    .querySelector(selector)!
    .dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, cancelable: true }));
}
afterEach(() => {
  controls.forEach((control) => control.detach());
  controls.length = 0;
  touches.forEach((touch) => touch.dispose());
  touches.length = 0;
  document.body.replaceChildren();
});

describe("keyboard driving controls", () => {
  it("clears held pedals and smoothed steering when the window loses focus", () => {
    const control = input();
    key("KeyW");
    key("KeyA");
    expect(control.read(1)).toEqual({ throttle: 1, brake: 0, steer: 1 });
    window.dispatchEvent(new Event("blur"));
    expect(control.read(0)).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });

  it("does not turn textarea typing into driving or respawning", () => {
    const control = input();
    control.onRespawn = vi.fn();
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    key("KeyW", false, textarea);
    key("KeyR", false, textarea);
    expect(control.read(1).throttle).toBe(0);
    expect(control.onRespawn).not.toHaveBeenCalled();
  });

  it("respawns once per press while repeated keydown events are ignored", () => {
    const control = input();
    control.onRespawn = vi.fn();
    key("KeyR");
    key("KeyR", true);
    expect(control.onRespawn).toHaveBeenCalledOnce();
  });

  it("starts neutral after detach and reattach", () => {
    const control = input();
    key("ArrowLeft");
    control.read(1);
    control.detach();
    control.attach();
    expect(control.read(0).steer).toBe(0);
  });
});

describe("touch steering through Input", () => {
  function touchInput(mode: "slider" | "buttons"): Input {
    const touch = new TouchControls(document.body, mode);
    touches.push(touch);
    return input(touch);
  }

  it("ramps a held left arrow toward full left lock like the A key", () => {
    const control = touchInput("buttons");
    hold(".touch-left", 1);
    expect(control.read(0.1).steer).toBeCloseTo(0.3);
    expect(control.read(0.1).steer).toBeCloseTo(0.6);
    expect(control.read(1).steer).toBe(1);
    hold(".touch-left", 1, "pointerup");
    expect(control.read(0.1).steer).toBeCloseTo(0.7);
    expect(control.read(1).steer).toBe(0);
  });

  it("ramps a held right arrow to negative steer", () => {
    const control = touchInput("buttons");
    hold(".touch-right", 1);
    expect(control.read(0.1).steer).toBeCloseTo(-0.3);
    expect(control.read(1).steer).toBe(-1);
  });

  it("holds neutral while both arrows are down", () => {
    const control = touchInput("buttons");
    hold(".touch-left", 1);
    hold(".touch-right", 2);
    expect(control.read(1).steer).toBe(0);
  });

  it("does not exceed full lock with the A key and the left arrow held together", () => {
    const control = touchInput("buttons");
    hold(".touch-left", 1);
    key("KeyA");
    expect(control.read(0.1).steer).toBeCloseTo(0.3);
    expect(control.read(1).steer).toBe(1);
  });

  it("drops arrow steering when the window loses focus", () => {
    const control = touchInput("buttons");
    hold(".touch-left", 1);
    control.read(1);
    window.dispatchEvent(new Event("blur"));
    expect(control.read(0).steer).toBe(0);
    expect(control.read(1).steer).toBe(0);
  });

  it("rate-limits the analog slider the same way, both onto full lock and back", () => {
    const control = touchInput("slider");
    const steer = document.querySelector<HTMLElement>(".touch-steer")!;
    vi.spyOn(steer, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 200, 60));
    hold(".touch-steer", 1, "pointerdown", 100);
    expect(control.read(0.1).steer).toBeCloseTo(0.3);
    expect(control.read(0.2).steer).toBeCloseTo(0.9);
    expect(control.read(0.1).steer).toBe(1);
    hold(".touch-steer", 1, "pointermove", 300);
    expect(control.read(0.5).steer).toBeCloseTo(-0.5);
    expect(control.read(1).steer).toBe(-1);
    hold(".touch-steer", 1, "pointerup");
    expect(control.read(0.1).steer).toBeCloseTo(-0.7);
    expect(control.read(1).steer).toBe(0);
  });

  it("eases toward a partial slider position without overshooting it", () => {
    const control = touchInput("slider");
    const steer = document.querySelector<HTMLElement>(".touch-steer")!;
    vi.spyOn(steer, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 200, 60));
    hold(".touch-steer", 1, "pointerdown", 150);
    const partial = (0.5 - 0.15) / 0.85;
    expect(control.read(0.05).steer).toBeCloseTo(0.15);
    expect(control.read(1).steer).toBeCloseTo(partial);
    expect(control.read(1).steer).toBeCloseTo(partial);
  });
});
