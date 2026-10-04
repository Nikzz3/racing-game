// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sound, type DriverSound, type HeardCar } from "./sound";
import { SoundSettings } from "./sound-settings";
import type { Listener } from "./sound-model";

/** An AudioParam that jumps straight to each target, so tests read where it is headed. */
class FakeParam {
  constructor(public value: number) {}
  setTargetAtTime(value: number): this {
    this.value = value;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  readonly outputs = new Set<FakeNode>();
  connect<T extends FakeNode>(node: T): T {
    this.outputs.add(node);
    return node;
  }
  disconnect(): void {
    this.outputs.clear();
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  started = false;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeBuffer {
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  // Low, so synthesising the sounds stays quick.
  readonly sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  /** Whether resume() may start the context; autoplay rules can refuse it. */
  allowed = true;
  resume = vi.fn(() => {
    if (this.allowed) this.state = "running";
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.state = "suspended";
    return Promise.resolve();
  });
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(channels, length, rate);
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(350) });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam(0) });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(-24),
      knee: new FakeParam(30),
      ratio: new FakeParam(12),
    });
  }
}

const TOP_SPEED = 80;
const LISTENER: Listener = { x: 0, z: 0, forwardX: 0, forwardZ: 1 };
const PARKED: DriverSound = { speed: 0, throttle: 0, steer: 0, onTrack: true, hit: 0 };

let context: FakeContext;
let hidden = false;

function sound(settings = new SoundSettings()): Sound {
  return new Sound(settings, () => context as unknown as AudioContext);
}

function car(id: string, z: number, extra: Partial<HeardCar> = {}): HeardCar {
  return { id, x: 0, z, speed: 20, ...extra };
}

/** The looping sources still playing (not stopped). */
function playing(): FakeSource[] {
  return context.sources.filter((source) => source.loop && source.stoppedAt === null);
}

beforeEach(() => {
  context = new FakeContext();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("Sound", () => {
  it("has no race sound where the browser has no Web Audio", () => {
    const silent = new Sound(new SoundSettings(), () => null);
    expect(silent.race(TOP_SPEED)).toBeNull();
    expect(silent.state()).toBeNull();
  });

  it("starts the context for a race, and suspends it once the race is over", () => {
    vi.useFakeTimers();
    const output = sound();
    expect(output.state()).toBeNull();
    const race = output.race(TOP_SPEED)!;
    expect(context.resume).toHaveBeenCalledOnce();
    expect(output.state()?.context).toBe("running");
    race.dispose();
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(context.suspend).toHaveBeenCalledOnce();
    // The next race reuses the context.
    output.race(TOP_SPEED);
    expect(context.state).toBe("running");
  });

  it("retries a start the autoplay policy refused on the next user gesture", () => {
    context.allowed = false;
    const output = sound();
    output.race(TOP_SPEED);
    expect(output.state()?.context).toBe("suspended");
    context.allowed = true;
    window.dispatchEvent(new KeyboardEvent("keydown"));
    expect(output.state()?.context).toBe("running");
  });

  it("falls silent while the page is hidden", () => {
    const output = sound();
    output.race(TOP_SPEED);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(context.state).toBe("suspended");
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(context.state).toBe("running");
  });

  it("plays the mix at the driver's volume, and silent while muted", () => {
    const settings = new SoundSettings();
    settings.setVolume(50);
    const output = sound(settings);
    output.race(TOP_SPEED);
    const master = context.gains[0];
    expect(master.gain.value).toBeCloseTo(0.25);
    settings.toggleMuted();
    expect(master.gain.value).toBe(0);
    expect(output.state()?.gain).toBe(0);
    settings.setVolume(100);
    settings.toggleMuted();
    expect(master.gain.value).toBe(1);
  });
});

describe("RaceSound", () => {
  it("gives each nearby car an engine voice and releases cars that leave", () => {
    const race = sound().race(TOP_SPEED)!;
    expect(race.engines).toBe(1);
    const before = playing().length;
    race.update(1 / 60, PARKED, LISTENER, [car("a", 20), car("pacer", 30, { pacer: true })]);
    expect(race.engines).toBe(3);
    const perEngine = (playing().length - before) / 2;
    race.update(1 / 60, PARKED, LISTENER, [car("pacer", 30, { pacer: true })]);
    expect(race.engines).toBe(2);
    expect(playing().length).toBe(before + perEngine);
  });

  it("hears only the nearest six cars", () => {
    const race = sound().race(TOP_SPEED)!;
    const cars = Array.from({ length: 8 }, (_, index) => car(`c${index}`, 300 - index * 30));
    race.update(1 / 60, PARKED, LISTENER, cars);
    expect(race.engines).toBe(7);
    // The farthest two are the first two listed.
    race.update(1 / 60, PARKED, LISTENER, cars.slice(2));
    expect(race.engines).toBe(7);
  });

  it("revs the driver's engine with speed, and pulls harder on the throttle", () => {
    const race = sound().race(TOP_SPEED)!;
    const engine = context.sources.filter((source) => source.loop).slice(0, 4);
    const rate = () => engine[0].playbackRate.value;
    race.update(1 / 60, PARKED, LISTENER, []);
    const idle = rate();
    for (let frame = 0; frame < 60; frame++)
      race.update(1 / 60, { ...PARKED, speed: 15, throttle: 1 }, LISTENER, []);
    expect(rate()).toBeGreaterThan(idle * 2);
  });

  it("thuds once for a hit, and again only after a short gap", () => {
    const race = sound().race(TOP_SPEED)!;
    const thuds = () => context.sources.filter((source) => !source.loop && source.started);
    race.update(1 / 60, { ...PARKED, hit: 1 }, LISTENER, []);
    race.update(1 / 60, { ...PARKED, hit: 1 }, LISTENER, []);
    expect(thuds()).toHaveLength(1);
    context.currentTime += 0.2;
    race.update(1 / 60, { ...PARKED, hit: 0.5 }, LISTENER, []);
    expect(thuds()).toHaveLength(2);
  });

  it("stops every voice when the race ends, and ignores later frames", () => {
    const race = sound().race(TOP_SPEED)!;
    race.update(1 / 60, PARKED, LISTENER, [car("a", 20)]);
    race.dispose();
    expect(playing()).toHaveLength(0);
    expect(race.engines).toBe(0);
    race.update(1 / 60, PARKED, LISTENER, [car("b", 20)]);
    expect(race.engines).toBe(0);
    expect(playing()).toHaveLength(0);
  });
});
