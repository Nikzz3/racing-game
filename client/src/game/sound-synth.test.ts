import { describe, expect, it } from "vitest";
import {
  ENGINE_LOOP_RPMS,
  engineLoop,
  gravelLoop,
  loopable,
  roadLoop,
  squealLoop,
  thudShot,
} from "./sound-synth";

const RATE = 48_000;

function peak(samples: Float32Array): number {
  return samples.reduce((loudest, sample) => Math.max(loudest, Math.abs(sample)), 0);
}

function mean(samples: Float32Array): number {
  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
}

/** Typical sample-to-sample step: the jump across a loop's seam must look like any other. */
function typicalStep(samples: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < samples.length; i++) sum += Math.abs(samples[i] - samples[i - 1]);
  return sum / (samples.length - 1);
}

/** Correlation of the loop with itself shifted by `lag` samples, wrapping round. */
function autocorrelation(samples: Float32Array, lag: number): number {
  let sum = 0;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[(i + lag) % samples.length];
    energy += samples[i] * samples[i];
  }
  return sum / energy;
}

const LOOPS: [string, Float32Array][] = [
  ...ENGINE_LOOP_RPMS.map((rpm): [string, Float32Array] => [
    `engine at ${rpm} rpm`,
    engineLoop(RATE, rpm),
  ]),
  ["squeal", squealLoop(RATE)],
  ["road", roadLoop(RATE)],
  ["gravel", gravelLoop(RATE)],
];

describe("synthesised loops", () => {
  it.each(LOOPS)("%s loops without a click, centred and within range", (_, samples) => {
    expect(samples.length).toBeGreaterThan(RATE / 4);
    expect(Math.abs(samples[0] - samples[samples.length - 1])).toBeLessThan(
      6 * typicalStep(samples),
    );
    expect(Math.abs(mean(samples))).toBeLessThan(1e-3);
    expect(peak(samples)).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(peak(samples)).toBeGreaterThan(0.5);
  });

  it("builds each engine loop from whole engine cycles at its revs", () => {
    for (const rpm of ENGINE_LOOP_RPMS) {
      const samples = engineLoop(RATE, rpm);
      const cycle = (RATE * 120) / rpm;
      const cycles = samples.length / cycle;
      expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(0.01);
    }
  });

  it("pulses at the engine's firing rate: four times per cycle", () => {
    const rpm = 2200;
    const samples = engineLoop(RATE, rpm);
    const firing = Math.round((RATE * 60) / rpm / 2);
    // Repeats every firing far more than half a firing later.
    expect(autocorrelation(samples, firing)).toBeGreaterThan(0.5);
    expect(autocorrelation(samples, firing)).toBeGreaterThan(
      autocorrelation(samples, Math.round(firing / 2)) + 0.3,
    );
  });

  it("synthesises the same sounds every time", () => {
    expect(engineLoop(RATE, 4000)).toEqual(engineLoop(RATE, 4000));
    expect(engineLoop(RATE, 4000, 2)).not.toEqual(engineLoop(RATE, 4000, 1));
  });

  it("works at a 44.1 kHz output too", () => {
    const samples = engineLoop(44_100, 6800);
    expect(peak(samples)).toBeCloseTo(0.9);
  });
});

describe("thudShot", () => {
  it("starts silent, hits early and dies away", () => {
    const samples = thudShot(RATE);
    expect(samples[0]).toBe(0);
    expect(peak(samples.subarray(0, RATE / 20))).toBeCloseTo(0.9);
    expect(peak(samples.subarray(samples.length - RATE / 50))).toBeLessThan(0.05);
  });
});

describe("loopable", () => {
  it("drops the fade and joins its end into its start", () => {
    const ramp = Float32Array.from({ length: 10 }, (_, i) => i);
    const loop = loopable(ramp, 4);
    expect(loop).toHaveLength(6);
    // The start fades in from what followed the cut, so the end runs on into it.
    expect(loop[0]).toBeCloseTo(6);
    expect(Array.from(loop.subarray(4))).toEqual([4, 5]);
  });
});
