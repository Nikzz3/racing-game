import { describe, expect, it } from "vitest";
import {
  apparentThrottle,
  dopplerShift,
  Engine,
  engineLoopLevels,
  hearing,
  IDLE_RPM,
  impactLevel,
  REDLINE_RPM,
  roughness,
} from "./sound-model";

const TOP_SPEED = 80;

/** Runs the engine at `speed` long enough for its revs to settle. */
function settle(engine: Engine, speed: number, throttle = 1): Engine {
  for (let frame = 0; frame < 120; frame++) engine.update(1 / 60, speed, throttle);
  return engine;
}

describe("Engine", () => {
  it("idles at a standstill and revs up when the throttle is pressed", () => {
    expect(settle(new Engine(TOP_SPEED), 0, 0).rpm).toBeCloseTo(IDLE_RPM);
    const revving = settle(new Engine(TOP_SPEED), 0, 1).rpm;
    expect(revving).toBeGreaterThan(IDLE_RPM + 2000);
    expect(revving).toBeLessThan(REDLINE_RPM * 0.6);
  });

  it("climbs through the gears as the car speeds up, dropping the revs at each shift", () => {
    const engine = new Engine(TOP_SPEED);
    const drops: number[] = [];
    for (let speed = 0; speed <= TOP_SPEED; speed += 0.2) {
      const gear = engine.gear;
      const before = engine.rpm;
      engine.update(1 / 60, speed, 1);
      if (engine.gear !== gear) drops.push(before - engine.rpm);
      expect(engine.rpm).toBeLessThanOrEqual(REDLINE_RPM);
    }
    expect(engine.gear).toBe(4);
    expect(drops).toHaveLength(4);
    for (const drop of drops) expect(drop).toBeGreaterThan(200);
    // Settled at top speed the top gear sits below the redline.
    expect(settle(engine, TOP_SPEED).rpm).toBeLessThan(REDLINE_RPM * 0.95);
    expect(settle(engine, TOP_SPEED).rpm).toBeGreaterThan(REDLINE_RPM * 0.85);
  });

  it("drops a gear only well below the speed it shifted up at, so it never hunts", () => {
    const engine = new Engine(TOP_SPEED);
    let speed = 0;
    while (engine.gear < 2) engine.update(1 / 60, (speed += 0.1), 1);
    const upshiftSpeed = speed;
    engine.update(1 / 60, upshiftSpeed - 1, 1);
    engine.update(1 / 60, upshiftSpeed + 1, 1);
    expect(engine.gear).toBe(2);
    settle(engine, upshiftSpeed * 0.6);
    expect(engine.gear).toBe(1);
  });

  it("revs in reverse like in first gear", () => {
    expect(settle(new Engine(TOP_SPEED), -10).rpm).toBeCloseTo(
      settle(new Engine(TOP_SPEED), 10).rpm,
    );
  });

  it("follows the throttle with its load, smoothly", () => {
    const engine = new Engine(TOP_SPEED);
    engine.update(1 / 60, 20, 1);
    expect(engine.load).toBeGreaterThan(0);
    expect(engine.load).toBeLessThan(0.5);
    expect(settle(engine, 20, 1).load).toBeCloseTo(1);
    expect(settle(engine, 20, 0).load).toBeCloseTo(0);
  });
});

describe("engineLoopLevels", () => {
  const loops = [1000, 2000, 4000];

  it("plays the nearest loop alone outside the range", () => {
    expect(engineLoopLevels(800, loops)).toEqual([1, 0, 0]);
    expect(engineLoopLevels(9000, loops)).toEqual([0, 0, 1]);
    expect(engineLoopLevels(2000, loops)[1]).toBeCloseTo(1);
  });

  it("crossfades the two loops around the revs at equal power, halfway in pitch", () => {
    const levels = engineLoopLevels(Math.SQRT2 * 2000, loops);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeCloseTo(Math.SQRT1_2);
    expect(levels[2]).toBeCloseTo(Math.SQRT1_2);
    expect(levels[1] ** 2 + levels[2] ** 2).toBeCloseTo(1);
  });
});

describe("apparentThrottle", () => {
  it("reads pulling away as full throttle, holding speed as a little, slowing as none", () => {
    expect(apparentThrottle(20, 21, 1 / 60)).toBe(1);
    expect(apparentThrottle(20, 20, 1 / 60)).toBeCloseTo(0.3);
    expect(apparentThrottle(20, 19.5, 1 / 60)).toBe(0);
    expect(apparentThrottle(0, 0, 1 / 60)).toBe(0);
    expect(apparentThrottle(20, 21, 0)).toBe(0);
  });
});

describe("roughness and impactLevel", () => {
  it("is silent on the road and grows with speed across grass", () => {
    expect(roughness(30, true)).toBe(0);
    expect(roughness(0.5, false)).toBe(0);
    expect(roughness(5, false)).toBeCloseTo(0.5);
    expect(roughness(-20, false)).toBe(1);
  });

  it("ignores nudges and saturates on a hard hit", () => {
    expect(impactLevel(1)).toBe(0);
    expect(impactLevel(9.5)).toBeCloseTo(0.5);
    expect(impactLevel(40)).toBe(1);
  });
});

describe("hearing", () => {
  const listener = { x: 0, z: 0, forwardX: 0, forwardZ: 1 };

  it("places a car on the side it is on, relative to where the camera faces", () => {
    // Facing +z, +x is on the left (steering left raises the heading).
    expect(hearing(listener, 10, 0).pan).toBeCloseTo(-0.85);
    expect(hearing(listener, -10, 0).pan).toBeCloseTo(0.85);
    expect(hearing(listener, 0, 30).pan).toBeCloseTo(0);
    const turned = { ...listener, forwardX: 1, forwardZ: 0 };
    expect(hearing(turned, 0, 10).pan).toBeCloseTo(0.85);
  });

  it("keeps a close car at full level and fades a far one with distance", () => {
    expect(hearing(listener, 0, 5).level).toBe(1);
    expect(hearing(listener, 0, 48)).toMatchObject({ distance: 48, level: 0.25 });
    expect(hearing(listener, 0, 0)).toEqual({ distance: 0, pan: 0, level: 1 });
  });
});

describe("dopplerShift", () => {
  it("raises an approaching car's note and lowers a receding one's", () => {
    expect(dopplerShift(0)).toBe(1);
    expect(dopplerShift(-50)).toBeGreaterThan(1);
    expect(dopplerShift(50)).toBeLessThan(1);
    expect(dopplerShift(-120)).toBeLessThan(1.25);
  });
});
