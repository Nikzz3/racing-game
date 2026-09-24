import { describe, expect, it } from "vitest";
import { ServerClock } from "./server-clock";

describe("ServerClock", () => {
  it("reads local time before any snapshot", () => {
    expect(new ServerClock().now(123)).toBe(123);
  });

  it("reads server time as of the least-delayed snapshot", () => {
    const clock = new ServerClock();
    clock.observe(1_000, 5_020);
    clock.observe(1_050, 5_100);
    expect(clock.now(5_200)).toBe(1_180);
  });

  it("closes on a better estimate at 5% of elapsed time instead of jumping", () => {
    const clock = new ServerClock();
    clock.observe(0, 100);
    expect(clock.now(100)).toBe(0);
    clock.observe(100, 190); // 10 ms faster than any before
    expect(clock.now(200)).toBe(105);
    expect(clock.now(300)).toBe(210);
  });

  it("runs slow rather than halting or rewinding when its fastest snapshot leaves the window", () => {
    const clock = new ServerClock();
    clock.observe(0, 10);
    let previous = { local: 10, server: clock.now(10) };
    // Every later snapshot is 20 ms late, so the estimate steps back 10 ms at 5 s.
    for (let local = 26; local < 5_500; local += 16) {
      clock.observe(local - 20, local);
      const server = clock.now(local);
      const elapsed = local - previous.local;
      expect(server - previous.server).toBeGreaterThanOrEqual(0.95 * elapsed - 1e-9);
      expect(server - previous.server).toBeLessThanOrEqual(elapsed + 1e-9);
      if (local < 5_010) expect(server).toBe(local - 10);
      if (local > 5_300) expect(server).toBe(local - 20);
      previous = { local, server };
    }
  });

  it("takes a step beyond 100 ms at once, as when the server's clock is set", () => {
    const clock = new ServerClock();
    clock.observe(0, 10);
    expect(clock.now(20)).toBe(10);
    clock.observe(2_030, 30);
    expect(clock.now(40)).toBe(2_040);
  });
});
