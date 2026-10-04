// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamepadList } from "./gamepad";
import { Input } from "./input";
import { TouchControls } from "./touch";

const controls: Input[] = [];
const touches: TouchControls[] = [];
function input(touch: TouchControls | null = null, pads: () => GamepadList = () => []): Input {
  const control = new Input(touch, pads);
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

/** A keydown carrying both the key's label and its position, unlike `key()`. */
function press(init: KeyboardEventInit, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

describe("mute key", () => {
  it("toggles mute once per M press, never from a text field", () => {
    const control = input();
    control.onToggleMute = vi.fn();
    press({ key: "m", code: "KeyM" });
    press({ key: "m", code: "KeyM", repeat: true });
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    press({ key: "m", code: "KeyM" }, textarea);
    expect(control.onToggleMute).toHaveBeenCalledOnce();
    expect(control.read(1)).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });

  it("follows the key labelled M, wherever the layout puts it", () => {
    const control = input();
    control.onToggleMute = vi.fn();
    // AZERTY: M sits where QWERTY has the semicolon, and Caps Lock makes it "M".
    press({ key: "M", code: "Semicolon" });
    press({ key: ",", code: "KeyM" });
    expect(control.onToggleMute).toHaveBeenCalledOnce();
  });

  it("leaves M with a modifier to the browser and the OS", () => {
    const control = input();
    control.onToggleMute = vi.fn();
    for (const modifier of ["ctrlKey", "metaKey", "altKey"])
      press({ key: "m", code: "KeyM", [modifier]: true });
    expect(control.onToggleMute).not.toHaveBeenCalled();
  });
});

function button(value: number): GamepadButton {
  return { pressed: value >= 0.5, touched: value > 0, value };
}

describe("gamepad driving through Input", () => {
  /** One standard pad whose stick, triggers and Y a test sets. */
  function padInput() {
    const state = { stick: 0, throttle: 0, brake: 0, respawn: false };
    const pads = () => [
      {
        connected: true,
        mapping: "standard",
        axes: [state.stick, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, index) =>
          button(
            index === 7
              ? state.throttle
              : index === 6
                ? state.brake
                : index === 3 && state.respawn
                  ? 1
                  : 0,
          ),
        ),
      } as unknown as Gamepad,
    ];
    return { control: input(null, pads), state };
  }

  it("passes analog pedals straight through", () => {
    const { control, state } = padInput();
    state.throttle = 0.525;
    state.brake = 0.335;
    const { throttle, brake } = control.read(0.016);
    expect(throttle).toBeCloseTo(0.5);
    expect(brake).toBeCloseTo(0.3);
  });

  it("eases the stick's steering in at the same rate as the keys", () => {
    const { control, state } = padInput();
    state.stick = -1;
    expect(control.read(0.1).steer).toBeCloseTo(0.3);
    expect(control.read(1).steer).toBe(1);
    state.stick = 0;
    expect(control.read(0.1).steer).toBeCloseTo(0.7);
  });

  it("keeps the strongest pedal of keyboard and pad", () => {
    const { control, state } = padInput();
    state.throttle = 0.3;
    key("KeyW");
    expect(control.read(0).throttle).toBe(1);
  });

  it("respawns once per press of Y", () => {
    const { control, state } = padInput();
    control.onRespawn = vi.fn();
    state.respawn = true;
    control.read(0.016);
    control.read(0.016);
    expect(control.onRespawn).toHaveBeenCalledOnce();
    state.respawn = false;
    control.read(0.016);
    state.respawn = true;
    control.read(0.016);
    expect(control.onRespawn).toHaveBeenCalledTimes(2);
  });
});
