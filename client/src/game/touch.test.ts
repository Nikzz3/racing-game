// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TouchControls } from "./touch";

let controls: TouchControls | undefined;
afterEach(() => {
  controls?.dispose();
  document.body.replaceChildren();
});
function setup(): HTMLElement {
  controls = new TouchControls(document.body);
  const root = document.querySelector<HTMLElement>(".joystick")!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 200,
    right: 200,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON() {},
  });
  return root;
}
function pointer(root: HTMLElement, type: string, id: number, x = 100, y = 0): void {
  root.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y }));
}
describe("touch driving controls", () => {
  it("keeps the first pointer in control and releases on lost capture", () => {
    const root = setup();
    pointer(root, "pointerdown", 1);
    expect(controls!.read().throttle).toBe(1);
    pointer(root, "pointerdown", 2, 100, 200);
    pointer(root, "pointerup", 2);
    expect(controls!.read().throttle).toBe(1);
    pointer(root, "lostpointercapture", 1);
    expect(controls!.read()).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
  it("returns to neutral when the window loses focus", () => {
    const root = setup();
    pointer(root, "pointerdown", 1, 0, 100);
    expect(controls!.read().steer).toBe(1);
    window.dispatchEvent(new Event("blur"));
    expect(controls!.read().steer).toBe(0);
  });
  it("does not produce invalid inputs before the control has a layout", () => {
    controls = new TouchControls(document.body);
    const root = document.querySelector<HTMLElement>(".joystick")!;
    pointer(root, "pointerdown", 1);
    expect(controls.read()).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
});
