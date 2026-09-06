// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./input";

const controls: Input[] = [];
function input(): Input {
  const control = new Input();
  control.attach();
  controls.push(control);
  return control;
}
function key(code: string, repeat = false, target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code, repeat, bubbles: true }),
  );
}
afterEach(() => {
  controls.forEach((control) => control.detach());
  controls.length = 0;
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
