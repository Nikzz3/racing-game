import { describe, expect, it } from "vitest";
import { ClockOffset } from "@racing/shared";

/** Deterministic noise in [0, 1). */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("ClockOffset", () => {
  it("knows nothing before the first message", () => {
    expect(new ClockOffset().offset).toBeNull();
  });

  it("settles on the least-delayed message, ignoring delay spikes and bunched deliveries", () => {
    const clock = new ClockOffset();
    const random = noise(1);
    // Sender clock is 10 s behind the receiver; transit takes 20 ms plus jitter.
    for (let sent = 0; sent < 3_000; sent += 50) {
      const spike = random() < 0.1 ? 400 : 0;
      clock.observe(sent, sent + 10_000 + 20 + random() * 30 + spike);
      if (sent < 1_000) continue;
      expect(clock.offset).toBeGreaterThanOrEqual(10_020);
      expect(clock.offset).toBeLessThan(10_026);
    }
    // A stall that delivers a second of messages at once changes nothing.
    const settled = clock.offset;
    for (let sent = 3_000; sent < 4_000; sent += 50) clock.observe(sent, 14_025);
    expect(clock.offset).toBe(settled);
  });

  it("follows a sender clock drifting either way", () => {
    for (const rate of [1.002, 0.998]) {
      const clock = new ClockOffset();
      const random = noise(2);
      for (let received = 0; received < 60_000; received += 50) {
        clock.observe(received * rate - 20 - random() * 30, received);
        if (received < 10_000) continue;
        // The true offset at this instant, plus the 20 ms minimum delay.
        const truth = received - received * rate + 20;
        // Error is bounded by the drift across one window (5 s × 2 ms/s) plus a little jitter.
        expect(Math.abs(clock.offset! - truth)).toBeLessThan(12);
      }
    }
  });

  it("forgets a least-delayed sample once it leaves the window", () => {
    const clock = new ClockOffset();
    clock.observe(0, 5);
    for (let received = 100; received <= 5_000; received += 100)
      clock.observe(received - 50, received);
    expect(clock.offset).toBe(5);
    clock.observe(5_050, 5_100);
    expect(clock.offset).toBe(50);
  });
});
