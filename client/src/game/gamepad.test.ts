import { describe, expect, it, vi } from "vitest";
import { browserGamepads, readGamepads, Rumble, type GamepadList } from "./gamepad";

interface PadState {
  axes?: number[];
  /** Button index → analog value; at least 0.5 counts as pressed. */
  buttons?: Record<number, number>;
  connected?: boolean;
  playEffect?: GamepadHapticActuator["playEffect"] | null;
}

function pad({ axes = [0, 0, 0, 0], buttons = {}, connected = true, playEffect }: PadState = {}) {
  const list = Array.from({ length: 17 }, (_, index) => {
    const value = buttons[index] ?? 0;
    return { pressed: value >= 0.5, touched: value > 0, value };
  });
  return {
    axes,
    buttons: list,
    connected,
    mapping: "standard",
    vibrationActuator:
      playEffect === null
        ? null
        : { playEffect: playEffect ?? vi.fn(() => Promise.resolve("complete")) },
  } as unknown as Gamepad;
}

const RT = 7;
const LT = 6;

describe("readGamepads", () => {
  it("reads nothing without a connected pad", () => {
    expect(readGamepads([])).toBeNull();
    expect(readGamepads([null, null])).toBeNull();
    expect(readGamepads([pad({ connected: false, buttons: { [RT]: 1 } })])).toBeNull();
  });

  it("is neutral with a pad at rest", () => {
    expect(readGamepads([pad()])).toEqual({ throttle: 0, brake: 0, steer: 0, respawn: false });
  });

  it("reads the triggers as analog pedals", () => {
    const reading = readGamepads([pad({ buttons: { [RT]: 0.525, [LT]: 1 } })]);
    expect(reading?.throttle).toBeCloseTo(0.5);
    expect(reading?.brake).toBe(1);
  });

  it("ignores a trigger resting slightly pressed, so the car still coasts", () => {
    expect(readGamepads([pad({ buttons: { [RT]: 0.04, [LT]: 0.05 } })])).toMatchObject({
      throttle: 0,
      brake: 0,
    });
  });

  it("steers left-positive from the stick, past a dead zone it rescales out of", () => {
    expect(readGamepads([pad({ axes: [-1, 0] })])?.steer).toBe(1);
    expect(readGamepads([pad({ axes: [1, 0] })])?.steer).toBe(-1);
    expect(readGamepads([pad({ axes: [0.1, 0] })])?.steer).toBe(0);
    expect(readGamepads([pad({ axes: [-0.575, 0] })])?.steer).toBeCloseTo(0.5);
  });

  it("drives with the face buttons and the d-pad too", () => {
    expect(readGamepads([pad({ buttons: { 0: 1, 14: 1 } })])).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
      respawn: false,
    });
    expect(readGamepads([pad({ buttons: { 2: 1, 15: 1 } })])).toMatchObject({
      brake: 1,
      steer: -1,
    });
  });

  it("respawns on Y", () => {
    expect(readGamepads([pad({ buttons: { 3: 1 } })])?.respawn).toBe(true);
  });

  it("adds pads together without passing full lock", () => {
    const reading = readGamepads([
      pad({ axes: [-1, 0], buttons: { [RT]: 0.3 } }),
      null,
      pad({ buttons: { 14: 1, [RT]: 1 } }),
    ]);
    expect(reading).toMatchObject({ throttle: 1, steer: 1 });
  });
});

function rumbling(pads: GamepadList): Rumble {
  return new Rumble(() => pads);
}

describe("Rumble", () => {
  it("jolts every pad that can rumble on a hit, harder for a harder hit", () => {
    const playEffect = vi.fn(() => Promise.resolve("complete" as const));
    const rumble = rumbling([pad({ playEffect }), pad({ playEffect: null }), null]);
    rumble.impact(0.2, 0);
    rumble.impact(1, 1000);
    expect(playEffect).toHaveBeenCalledTimes(2);
    const [soft, hard] = playEffect.mock.calls.map(
      (call) => (call as unknown as [string, GamepadEffectParameters])[1],
    );
    expect(playEffect.mock.calls[0]).toContain("dual-rumble");
    expect(hard.strongMagnitude!).toBeGreaterThan(soft.strongMagnitude!);
    expect(hard.duration!).toBeGreaterThan(soft.duration!);
    expect(hard.strongMagnitude).toBeLessThanOrEqual(1);
  });

  it("ignores a hit of nothing", () => {
    const playEffect = vi.fn(() => Promise.resolve("complete" as const));
    rumbling([pad({ playEffect })]).impact(0, 0);
    expect(playEffect).not.toHaveBeenCalled();
  });

  it("renews the off-road buzz before it runs out, not every frame", () => {
    const playEffect = vi.fn(() => Promise.resolve("complete" as const));
    const rumble = rumbling([pad({ playEffect })]);
    for (let now = 0; now < 300; now += 16) rumble.surface(0.5, now);
    expect(playEffect).toHaveBeenCalledTimes(3);
    rumble.surface(0, 400);
    expect(playEffect).toHaveBeenCalledTimes(3);
  });

  it("lets a hit's jolt finish before the off-road buzz resumes", () => {
    const playEffect = vi.fn(() => Promise.resolve("complete" as const));
    const rumble = rumbling([pad({ playEffect })]);
    rumble.impact(1, 0);
    rumble.surface(1, 100);
    expect(playEffect).toHaveBeenCalledTimes(1);
    rumble.surface(1, 300);
    expect(playEffect).toHaveBeenCalledTimes(2);
  });

  it("swallows a refused effect", async () => {
    const playEffect = vi.fn(() => Promise.reject(new Error("busy")));
    rumbling([pad({ playEffect })]).impact(1, 0);
    await Promise.resolve();
    expect(playEffect).toHaveBeenCalledOnce();
  });
});

describe("browserGamepads", () => {
  it("reads no pads where the browser refuses the Gamepad API", () => {
    const getGamepads = vi.fn(() => {
      throw new DOMException("Not allowed", "SecurityError");
    });
    vi.stubGlobal("navigator", { getGamepads });
    try {
      expect(browserGamepads()).toEqual([]);
      expect(getGamepads).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
