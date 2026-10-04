import type { E2eSoundState } from "./e2e-seam";
import {
  Engine,
  REDLINE_RPM,
  apparentThrottle,
  approach,
  dopplerShift,
  engineLoopLevels,
  hearing,
  roughness,
  squealLevel,
  type Listener,
} from "./sound-model";
import type { SoundSettings } from "./sound-settings";
import {
  ENGINE_LOOP_RPMS,
  engineLoop,
  gravelLoop,
  roadLoop,
  squealLoop,
  thudShot,
} from "./sound-synth";

/** Events that count as a user gesture under autoplay rules, so they may start the audio. */
const GESTURES = ["pointerdown", "pointerup", "keydown", "touchend"] as const;
/** Time constant (s) levels and pitches glide to each frame's value with; steps would crackle. */
const GLIDE = 0.03;
/** How long a voice takes to fall silent when it stops (s). */
const RELEASE = 0.05;

// The mix, before the driver's volume.
const ENGINE_LEVEL = 0.55;
const SQUEAL_LEVEL = 0.2;
const ROAD_LEVEL = 0.12;
const GRAVEL_LEVEL = 0.45;
const THUD_LEVEL = 0.9;
/** Other players' engines sit under the driver's own, and Pacers quieter still. */
const OTHER_ENGINE_LEVEL = 0.3;
const PACER_ENGINE_LEVEL = 0.2;
/** Only the nearest cars get an engine voice; anything further is barely audible anyway. */
const HEARD_CARS = 6;
/** A heard car competes for its voice as if this much nearer than it is. */
const VOICE_HYSTERESIS = 0.8;
/** Shortest gap between two thuds (s): a shove that lasts several steps is one hit. */
const THUD_GAP = 0.12;
/** A teleport (respawn, join) is not motion: cap the speed Doppler sees (m/s). */
const MAX_RECEDING_SPEED = 120;

interface SoundBuffers {
  engine: AudioBuffer[];
  squeal: AudioBuffer;
  road: AudioBuffer;
  gravel: AudioBuffer;
  thud: AudioBuffer;
}

/** The driver's own car, as its sound needs it this frame. */
export interface DriverSound {
  speed: number;
  throttle: number;
  /** The steer the car is turning with, -1..1. */
  steer: number;
  onTrack: boolean;
  /** How hard the car was hit this frame, 0..1 (`impactLevel`). */
  hit: number;
}

/** Another car the driver can hear: a remote player or the Pacer. */
export interface HeardCar {
  id: string;
  x: number;
  z: number;
  speed: number;
  pacer?: boolean;
}

function browserContext(): AudioContext | null {
  return typeof AudioContext === "function" ? new AudioContext() : null;
}

/**
 * The game's audio output, one per app: the AudioContext, the master volume that follows
 * the driver's settings, and the synthesised sounds. Autoplay rules only let a context
 * start inside a user gesture (Safari) or after one (Chromium), so the first gesture in
 * the Lobby creates and starts it, which lets a race resume it later without one. The
 * context only runs while a race is on a visible page.
 */
export class Sound {
  private context: AudioContext | null = null;
  /** Built for the first race: synthesising the sounds takes tens of milliseconds. */
  private mix: { master: GainNode; buffers: SoundBuffers } | null = null;
  private races = 0;
  /** No Web Audio, or the browser refused a context: every race runs silent. */
  private unavailable = false;
  /** Whether the context has ever run; see `gesture`. */
  private started = false;

  constructor(
    readonly settings: SoundSettings,
    private readonly createContext: () => AudioContext | null = browserContext,
  ) {
    settings.subscribe(() => this.applyVolume());
    for (const type of GESTURES) window.addEventListener(type, this.gesture, { capture: true });
    document.addEventListener("visibilitychange", this.wake);
  }

  /** The sound of one race, or null where the browser has no Web Audio. */
  race(topSpeed: number): RaceSound | null {
    const context = this.open();
    if (!context) return null;
    let race: RaceSound;
    try {
      this.mix ??= buildMix(context, this.settings.gain);
      race = new RaceSound(context, this.mix.master, this.mix.buffers, topSpeed, () => {
        this.races--;
        // Let the stopped voices fade before the context stops rendering.
        setTimeout(this.wake, (RELEASE * 2 + 0.05) * 1000);
      });
    } catch (error) {
      // Out of memory, say: lose the sound, not the race. Any voice started before the
      // failure never had its level raised from 0.
      console.warn("Race sound could not start", error);
      return null;
    }
    this.races++;
    this.wake();
    return race;
  }

  /** The output as the e2e journey sees it: null before the first race. */
  state(): Omit<E2eSoundState, "engines"> | null {
    if (!this.context || !this.mix) return null;
    return { context: this.context.state, gain: this.mix.master.gain.value };
  }

  private open(): AudioContext | null {
    if (this.context || this.unavailable) return this.context;
    try {
      this.context = this.createContext();
    } catch (error) {
      // Browsers cap how many contexts a page may hold; the races run silent instead.
      console.warn("Audio could not start", error);
    }
    if (!this.context) {
      this.unavailable = true;
      return null;
    }
    // A suspend or resume only lands later, so act again on whatever state it reaches.
    this.context.onstatechange = this.wake;
    return this.context;
  }

  /**
   * Started inside a gesture, the context may be resumed later without one. A start can
   * be refused (a touch only counts once released), so every gesture retries until the
   * context has run once.
   */
  private gesture = (): void => {
    const context = this.open();
    if (context && !this.started && context.state !== "running")
      context.resume().catch(() => undefined);
    else this.wake();
  };

  /**
   * Runs the context while a race is on a visible page and suspends it otherwise. As a
   * gesture listener it also retries a start the autoplay policy refused.
   */
  private wake = (): void => {
    const context = this.context;
    if (!context) return;
    if (context.state === "running") this.started = true;
    const wanted = this.races > 0 && !document.hidden;
    // Safari also stops a context as "interrupted" (a phone call, say), which resume() ends.
    // Both reject while the context is closing; there is nothing left to play then.
    const { state } = context;
    if (wanted && state !== "running" && state !== "closed")
      context.resume().catch(() => undefined);
    else if (!wanted && state === "running") context.suspend().catch(() => undefined);
  };

  private applyVolume(): void {
    if (!this.context || !this.mix) return;
    this.mix.master.gain.setTargetAtTime(this.settings.gain, this.context.currentTime, GLIDE);
  }
}

/** The master volume, a limiter after it, and every sound synthesised at the context's rate. */
function buildMix(
  context: AudioContext,
  gain: number,
): { master: GainNode; buffers: SoundBuffers } {
  const master = context.createGain();
  master.gain.value = gain;
  // Several cars, a squeal and a thud can stack up; squash the peaks instead of clipping.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 10;
  limiter.ratio.value = 6;
  master.connect(limiter).connect(context.destination);
  const loop = (samples: Float32Array) => {
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  };
  const rate = context.sampleRate;
  return {
    master,
    buffers: {
      engine: ENGINE_LOOP_RPMS.map((rpm, index) => loop(engineLoop(rate, rpm, index + 1))),
      squeal: loop(squealLoop(rate)),
      road: loop(roadLoop(rate)),
      gravel: loop(gravelLoop(rate)),
      thud: loop(thudShot(rate)),
    },
  };
}

/**
 * Everything one race sounds like: the driver's engine, tyre squeal, the road or grass
 * under the car and the thud of a hit, plus a quieter engine placed in the stereo field
 * for each nearby remote car and the Pacer.
 */
export class RaceSound {
  private readonly output: GainNode;
  private readonly engine: Engine;
  private readonly engineVoice: EngineVoice;
  private readonly squeal: LoopVoice;
  private readonly road: LoopVoice;
  private readonly gravel: LoopVoice;
  private readonly others = new Map<string, OtherCar>();
  private lastThud = Number.NEGATIVE_INFINITY;
  private ended = false;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    private readonly buffers: SoundBuffers,
    private readonly topSpeed: number,
    private readonly onEnd: () => void,
  ) {
    this.output = context.createGain();
    this.output.connect(destination);
    this.engine = new Engine(topSpeed);
    this.engineVoice = new EngineVoice(context, buffers.engine, this.output);
    this.squeal = new LoopVoice(context, buffers.squeal, this.output);
    this.road = new LoopVoice(context, buffers.road, this.output, 600);
    this.gravel = new LoopVoice(context, buffers.gravel, this.output);
  }

  /** Engine voices playing: the driver's and one per heard car. */
  get engines(): number {
    return this.ended ? 0 : 1 + this.others.size;
  }

  update(dt: number, driver: DriverSound, listener: Listener, cars: readonly HeardCar[]): void {
    if (this.ended) return;
    const now = this.context.currentTime;
    const speed = Math.abs(driver.speed);
    const speedShare = Math.min(1, speed / Math.max(1, this.topSpeed));
    this.engine.update(dt, driver.speed, driver.throttle);
    this.engineVoice.set(this.engine.rpm, this.engine.load, ENGINE_LEVEL);
    const squeal = squealLevel(driver.speed, driver.steer, driver.onTrack);
    this.squeal.set(SQUEAL_LEVEL * squeal, 0.95 + 0.1 * squeal);
    this.road.set(
      ROAD_LEVEL * speedShare * speedShare * (driver.onTrack ? 1 : 0.4),
      0.8 + 0.4 * speedShare,
      300 + 1500 * speedShare,
    );
    this.gravel.set(
      GRAVEL_LEVEL * roughness(driver.speed, driver.onTrack),
      0.7 + 0.5 * Math.min(1, speed / 20),
    );
    if (driver.hit > 0 && now - this.lastThud >= THUD_GAP) {
      this.lastThud = now;
      this.thud(driver.hit);
    }
    this.hear(dt, listener, cars);
  }

  /** Gives the nearest cars an engine voice placed where they are, and releases the rest. */
  private hear(dt: number, listener: Listener, cars: readonly HeardCar[]): void {
    const audible: (HeardCar & ReturnType<typeof hearing> & { rank: number })[] = [];
    for (const car of cars) {
      const heard = hearing(listener, car.x, car.z);
      // Other clients' poses are relayed unchecked, and an AudioParam throws on a value
      // that isn't finite: a forged pose must not reach one.
      if (!Number.isFinite(heard.distance) || !Number.isFinite(car.speed)) continue;
      // A car already heard keeps its voice until another is clearly nearer, so two cars
      // at the edge of earshot don't trade one back and forth.
      const rank = heard.distance * (this.others.has(car.id) ? VOICE_HYSTERESIS : 1);
      audible.push({ ...car, ...heard, rank });
    }
    audible.sort((a, b) => a.rank - b.rank);
    const present = new Set<string>();
    for (const car of audible.slice(0, HEARD_CARS)) {
      present.add(car.id);
      let other = this.others.get(car.id);
      if (!other) {
        other = new OtherCar(this.context, this.buffers.engine, this.output, this.topSpeed);
        other.place(car.distance, car.speed);
        this.others.set(car.id, other);
      }
      const base = car.pacer ? PACER_ENGINE_LEVEL : OTHER_ENGINE_LEVEL;
      other.update(dt, car.speed, car.distance, car.pan, base * car.level);
    }
    for (const [id, other] of this.others) {
      if (present.has(id)) continue;
      other.stop();
      this.others.delete(id);
    }
  }

  private thud(level: number): void {
    const source = this.context.createBufferSource();
    source.buffer = this.buffers.thud;
    // Each hit a little different.
    source.playbackRate.value = 0.85 + 0.3 * Math.random();
    const gain = this.context.createGain();
    gain.gain.value = THUD_LEVEL * (0.35 + 0.65 * level);
    source.connect(gain).connect(this.output);
    source.onended = () => gain.disconnect();
    source.start();
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.engineVoice.stop();
    this.squeal.stop();
    this.road.stop();
    this.gravel.stop();
    for (const other of this.others.values()) other.stop();
    this.others.clear();
    const output = this.output;
    setTimeout(() => output.disconnect(), RELEASE * 4 * 1000);
    this.onEnd();
  }
}

/**
 * One engine: every loop plays at once, pitched to the revs, and the two built nearest
 * them are faded in. Load opens a low-pass filter and raises the level.
 */
class EngineVoice {
  private readonly sources: AudioBufferSourceNode[];
  private readonly levels: GainNode[];
  private readonly tone: BiquadFilterNode;
  readonly output: GainNode;

  constructor(
    private readonly context: AudioContext,
    buffers: AudioBuffer[],
    destination: AudioNode,
  ) {
    this.tone = context.createBiquadFilter();
    this.tone.type = "lowpass";
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.tone.connect(this.output).connect(destination);
    this.levels = buffers.map(() => {
      const level = context.createGain();
      level.gain.value = 0;
      level.connect(this.tone);
      return level;
    });
    this.sources = buffers.map((buffer, index) => startLoop(context, buffer, this.levels[index]));
  }

  /** `pitch` bends the whole note, for Doppler. */
  set(rpm: number, load: number, level: number, pitch = 1): void {
    const now = this.context.currentTime;
    const levels = engineLoopLevels(rpm, ENGINE_LOOP_RPMS);
    for (const [index, source] of this.sources.entries()) {
      source.playbackRate.setTargetAtTime((rpm / ENGINE_LOOP_RPMS[index]) * pitch, now, GLIDE);
      this.levels[index].gain.setTargetAtTime(levels[index], now, GLIDE);
    }
    this.tone.frequency.setTargetAtTime(500 + 2500 * load + 0.3 * rpm, now, GLIDE);
    const loudness = level * (0.4 + 0.6 * load) * (0.8 + 0.2 * (rpm / REDLINE_RPM));
    this.output.gain.setTargetAtTime(loudness, now, GLIDE);
  }

  stop(): void {
    release(this.context, this.output, this.sources);
  }
}

/** A remote car or the Pacer: an engine judged from its speed, panned and Doppler-shifted. */
class OtherCar {
  private readonly engine: Engine;
  private readonly voice: EngineVoice;
  private readonly panner: StereoPannerNode;
  private speed = 0;
  private distance = 0;
  /** How fast it is moving away from the listener (m/s), smoothed. */
  private receding = 0;

  constructor(
    private readonly context: AudioContext,
    buffers: AudioBuffer[],
    destination: AudioNode,
    topSpeed: number,
  ) {
    this.engine = new Engine(topSpeed);
    this.panner = context.createStereoPanner();
    this.panner.connect(destination);
    this.voice = new EngineVoice(context, buffers, this.panner);
  }

  /**
   * Where it was first heard and how fast it was going, so its first frame isn't heard as
   * a jump in Doppler or as an engine revving up from idle.
   */
  place(distance: number, speed: number): void {
    this.distance = distance;
    this.speed = speed;
    // A second of steady driving settles the gearbox at this speed.
    this.engine.update(1, speed, apparentThrottle(speed, speed, 1));
  }

  update(dt: number, speed: number, distance: number, pan: number, level: number): void {
    if (dt > 0) {
      const receding = Math.max(
        -MAX_RECEDING_SPEED,
        Math.min(MAX_RECEDING_SPEED, (distance - this.distance) / dt),
      );
      this.receding = approach(this.receding, receding, dt, 0.15);
    }
    this.engine.update(dt, speed, apparentThrottle(this.speed, speed, dt));
    this.speed = speed;
    this.distance = distance;
    this.panner.pan.setTargetAtTime(pan, this.context.currentTime, GLIDE);
    this.voice.set(this.engine.rpm, this.engine.load, level, dopplerShift(this.receding));
  }

  stop(): void {
    this.voice.stop();
    setTimeout(() => this.panner.disconnect(), RELEASE * 4 * 1000);
  }
}

/** One looping sound with a level, a playback rate and optionally a low-pass filter. */
class LoopVoice {
  private readonly source: AudioBufferSourceNode;
  private readonly output: GainNode;
  private readonly tone: BiquadFilterNode | null = null;

  constructor(
    private readonly context: AudioContext,
    buffer: AudioBuffer,
    destination: AudioNode,
    cutoff?: number,
  ) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
    let input: AudioNode = this.output;
    if (cutoff !== undefined) {
      this.tone = context.createBiquadFilter();
      this.tone.type = "lowpass";
      this.tone.frequency.value = cutoff;
      this.tone.connect(this.output);
      input = this.tone;
    }
    this.source = startLoop(context, buffer, input);
  }

  set(level: number, rate: number, cutoff?: number): void {
    const now = this.context.currentTime;
    this.output.gain.setTargetAtTime(level, now, GLIDE);
    this.source.playbackRate.setTargetAtTime(rate, now, GLIDE);
    if (cutoff !== undefined) this.tone?.frequency.setTargetAtTime(cutoff, now, GLIDE);
  }

  stop(): void {
    release(this.context, this.output, [this.source]);
  }
}

/** Starts `buffer` looping into `destination`, from a random point so identical voices don't phase. */
function startLoop(
  context: AudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(destination);
  source.start(context.currentTime, Math.random() * buffer.duration);
  return source;
}

/** Fades `output` out, then stops the sources and unplugs the voice. */
function release(
  context: AudioContext,
  output: GainNode,
  sources: readonly AudioBufferSourceNode[],
): void {
  const now = context.currentTime;
  output.gain.cancelScheduledValues(now);
  output.gain.setTargetAtTime(0, now, RELEASE / 3);
  for (const source of sources) source.stop(now + RELEASE * 2);
  sources[0].onended = () => output.disconnect();
}
