// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sound, type DriverSound, type HeardCar } from "./sound";
import { SoundSettings } from "./sound-settings";
import type { Listener } from "./sound-model";

/**
 * An AudioParam that jumps straight to each target, so tests read where it is headed. Like
 * a browser's, it throws on a value that isn't finite.
 */
class FakeParam {
  constructor(public value: number) {}
  setTargetAtTime(value: number): this {
    if (!Number.isFinite(value)) throw new TypeError(`The provided float value is non-finite.`);
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
  /** Like a real browser, change state a moment after the call and say so; else at once. */
  deferred = false;
  onstatechange: (() => void) | null = null;
  resume = vi.fn(() => this.become(this.allowed ? "running" : this.state));
  suspend = vi.fn(() => this.become("suspended"));
  private become(state: AudioContextState): Promise<void> {
    if (!this.deferred) {
      this.state = state;
      return Promise.resolve();
    }
    return Promise.resolve().then(() => {
      if (this.state === state) return;
      this.state = state;
      this.onstatechange?.();
    });
  }
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
const PARKED: DriverSound = { speed: 0, throttle: 0, onTrack: true, hit: 0 };

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

  it("starts the context on the Lobby's first gesture, so a race can resume it later", async () => {
    context.deferred = true;
    const create = vi.fn(() => context as unknown as AudioContext);
    const output = new Sound(new SoundSettings(), create);
    window.dispatchEvent(new PointerEvent("pointerdown"));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(create).toHaveBeenCalledOnce();
    // The release retries while the press's start is still landing; that is harmless.
    expect(context.resume).toHaveBeenCalled();
    // Started, and with no race on, stopped again.
    await vi.waitFor(() => expect(context.suspend).toHaveBeenCalled());
    await vi.waitFor(() => expect(context.state).toBe("suspended"));
    output.race(TOP_SPEED);
    await vi.waitFor(() => expect(context.state).toBe("running"));
    expect(create).toHaveBeenCalledOnce();
  });

  it("retries the start on every Lobby gesture until one is allowed", async () => {
    context.deferred = true;
    // A touch only activates the page on release: the press that created the context
    // couldn't start it.
    context.allowed = false;
    const output = sound();
    window.dispatchEvent(new PointerEvent("pointerdown"));
    await Promise.resolve();
    expect(context.state).toBe("suspended");
    context.allowed = true;
    window.dispatchEvent(new PointerEvent("pointerup"));
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(2));
    // Once it has run, the Lobby suspends it, and gestures stop retrying.
    await vi.waitFor(() => expect(context.suspend).toHaveBeenCalled());
    await vi.waitFor(() => expect(context.state).toBe("suspended"));
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(context.resume).toHaveBeenCalledTimes(2);
    output.race(TOP_SPEED);
    await vi.waitFor(() => expect(context.state).toBe("running"));
  });

  // Two failure points: partway through the engine's loops, and after the engine and road.
  it.each([2, 5])(
    "stops and unplugs everything a race sound started before failing (%i loops in)",
    (started) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const output = sound();
      // Build the shared mix with a first race, then fail the next one partway through.
      output.race(TOP_SPEED)!.dispose();
      const gainsBefore = context.gains.length;
      const sourcesBefore = context.sources.length;
      let sources = 0;
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        if (++sources > started) throw new DOMException("Out of memory", "NotSupportedError");
        return create();
      };
      expect(output.race(TOP_SPEED)).toBeNull();
      const begun = context.sources.slice(sourcesBefore);
      expect(begun).toHaveLength(started);
      for (const source of begun) expect(source.stoppedAt).not.toBeNull();
      // The failed race's own output, its first new gain node, is unplugged.
      expect(context.gains[gainsBefore].outputs.size).toBe(0);
    },
  );

  it("races on in silence when the sound can't be built", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    context.createBuffer = () => {
      throw new DOMException("Out of memory", "NotSupportedError");
    };
    const output = sound();
    expect(output.race(TOP_SPEED)).toBeNull();
    expect(warn).toHaveBeenCalled();
    // Not counted as a race, so nothing keeps the context running.
    vi.advanceTimersByTime(1000);
    expect(context.state).not.toBe("running");
  });

  it("resumes a race whose page came back before its suspend landed", async () => {
    const output = sound();
    output.race(TOP_SPEED);
    context.deferred = true;
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    hidden = false;
    // Still reported running: the suspend has not landed yet.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(context.state).toBe("running"));
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

  it("hears only the nearest six cars, and swaps one in only once it is clearly nearer", () => {
    const race = sound().race(TOP_SPEED)!;
    const stopped = () => context.sources.filter((source) => source.stoppedAt !== null).length;
    // Listed farthest first: c0 at 300 m in to c7 at 90 m.
    const cars = Array.from({ length: 8 }, (_, index) => car(`c${index}`, 300 - index * 30));
    race.update(1 / 60, PARKED, LISTENER, cars);
    expect(race.engines).toBe(7);
    // Dropping the two farthest releases no voice: they never had one.
    race.update(1 / 60, PARKED, LISTENER, cars.slice(2));
    expect(stopped()).toBe(0);
    // c1 edging just past c2, the farthest heard, doesn't take its voice…
    cars[1] = car("c1", 230);
    race.update(1 / 60, PARKED, LISTENER, cars);
    expect(stopped()).toBe(0);
    // …but well past it, it does.
    cars[1] = car("c1", 150);
    race.update(1 / 60, PARKED, LISTENER, cars);
    expect(race.engines).toBe(7);
    expect(stopped()).toBeGreaterThan(0);
  });

  it("starts a car's engine at the revs its speed implies, not from idle", () => {
    const race = sound().race(TOP_SPEED)!;
    const before = context.sources.length;
    race.update(1 / 60, PARKED, LISTENER, [car("fast", 20, { speed: 60 })]);
    const idleLoop = context.sources.slice(before).filter((source) => source.loop)[0];
    // The first engine loop is built at 1000 rpm: at 60 m/s the revs are far above it.
    expect(idleLoop.playbackRate.value).toBeGreaterThan(5);
  });

  it("silences a put-away car (a Spectator's) but keeps the cars it watches", () => {
    const race = sound().race(TOP_SPEED)!;
    // Created in order: master, the race's output, then the driver's engine voice.
    const driverEngine = context.gains[2];
    race.update(1 / 60, { ...PARKED, speed: 30, throttle: 1 }, LISTENER, []);
    expect(driverEngine.gain.value).toBeGreaterThan(0);
    race.update(1 / 60, null, LISTENER, [car("watched", 15)]);
    expect(driverEngine.gain.value).toBe(0);
    expect(race.engines).toBe(2);
  });

  it("ignores a car whose relayed pose or speed isn't a finite number", () => {
    const race = sound().race(TOP_SPEED)!;
    const forged = [
      car("far", 0, { x: 1.5e308, z: 1.5e308 }),
      car("nan", 20, { speed: Number.NaN }),
      car("fine", 30),
    ];
    expect(() => race.update(1 / 60, PARKED, LISTENER, forged)).not.toThrow();
    expect(race.engines).toBe(2);
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
