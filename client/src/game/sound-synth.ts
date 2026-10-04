/**
 * The game's sounds, synthesised at startup instead of shipped as recordings: no files
 * to download or license, and the desktop app works offline. Every loop repeats without
 * a seam, so a looping AudioBufferSourceNode never clicks.
 */

/** A four-cylinder four-stroke: every cylinder fires once per two revolutions. */
const CYLINDERS = 4;
/** The revs each engine loop is built at. A voice crossfades the two around its revs and pitches both to match. */
export const ENGINE_LOOP_RPMS = [1000, 2200, 4000, 6800] as const;
const ENGINE_LOOP_SECONDS = 0.5;
/** Per-cylinder differences repeat every cycle and give the note its burble. */
const CYLINDER_SPREAD = 0.35;
/** Firing-to-firing variation, kept small so the loop's repeat isn't heard. */
const FIRING_SPREAD = 0.1;

/**
 * One loop of engine at `rpm`: a whole number of engine cycles of exhaust pulses, each a
 * thump through the pipe's low resonances with a little combustion noise on top. Pulses
 * that run past the end wrap round to the start, so the loop has no seam.
 */
export function engineLoop(sampleRate: number, rpm: number, seed = 1): Float32Array {
  const random = mulberry32(seed);
  const cycleHz = rpm / 120;
  const cycles = Math.max(1, Math.round(ENGINE_LOOP_SECONDS * cycleHz));
  const length = Math.round((cycles * sampleRate) / cycleHz);
  const samples = new Float32Array(length);
  const firings = cycles * CYLINDERS;
  const cylinderLevel = Array.from(
    { length: CYLINDERS },
    () => 1 - CYLINDER_SPREAD / 2 + CYLINDER_SPREAD * random(),
  );
  const pulseLength = Math.min(length, Math.round(sampleRate * 0.03));
  for (let firing = 0; firing < firings; firing++) {
    const start = Math.round((firing * length) / firings);
    const level =
      cylinderLevel[firing % CYLINDERS] * (1 - FIRING_SPREAD / 2 + FIRING_SPREAD * random());
    for (let i = 0; i < pulseLength; i++) {
      const t = i / sampleRate;
      // A pulse that starts at full height would click at every firing; this one swells in
      // over a fraction of a millisecond.
      const onset = 1 - Math.exp(-t / 0.0004);
      const thump =
        onset *
        Math.exp(-t / 0.0045) *
        (Math.sin(2 * Math.PI * 95 * t) +
          0.55 * Math.sin(2 * Math.PI * 240 * t + 0.4) +
          0.2 * Math.sin(2 * Math.PI * 610 * t + 1.1));
      const noise = onset * (random() * 2 - 1) * Math.exp(-t / 0.0018) * 0.35;
      samples[(start + i) % length] += level * (thump + noise);
    }
  }
  // Soft saturation rounds the peaks of overlapping pulses into a fuller note.
  for (let i = 0; i < length; i++) samples[i] = Math.tanh(samples[i] * 1.4);
  return finish(samples, 0.9);
}

/** Tyre roar and wind: noise with most of its top end rolled off. */
export function roadLoop(sampleRate: number, seed = 3): Float32Array {
  const random = mulberry32(seed);
  const samples = new Float32Array(Math.round(sampleRate * 1.5));
  const smooth = onePole(sampleRate, 500);
  for (let i = 0; i < samples.length; i++) samples[i] = smooth(random() * 2 - 1);
  return finish(loopable(samples, Math.round(sampleRate * 0.08)), 0.8);
}

/** Grass and dirt under the tyres: a low rumble crackling with small stones. */
export function gravelLoop(sampleRate: number, seed = 4): Float32Array {
  const random = mulberry32(seed);
  const samples = new Float32Array(Math.round(sampleRate * 1.3));
  const rumble = onePole(sampleRate, 140);
  const grit = resonator(sampleRate, 2300, 2);
  let crackle = 0;
  for (let i = 0; i < samples.length; i++) {
    // About ninety small impacts a second, each a few milliseconds of grit.
    if (random() < 90 / sampleRate) crackle = 0.5 + random();
    crackle *= Math.exp(-1 / (0.003 * sampleRate));
    samples[i] = 1.6 * rumble(random() * 2 - 1) + grit((random() * 2 - 1) * crackle);
  }
  return finish(loopable(samples, Math.round(sampleRate * 0.08)), 0.8);
}

/** A hit: a low knock whose pitch falls away, with a burst of crunch. Played once. */
export function thudShot(sampleRate: number, seed = 5): Float32Array {
  const random = mulberry32(seed);
  const samples = new Float32Array(Math.round(sampleRate * 0.45));
  const crunch = onePole(sampleRate, 900);
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * (48 + 80 * Math.exp(-t / 0.035))) / sampleRate;
    const attack = Math.min(1, t / 0.001);
    samples[i] =
      attack *
      (Math.exp(-t / 0.1) * Math.sin(phase) +
        0.7 * Math.exp(-t / 0.03) * crunch(random() * 2 - 1) * 3);
  }
  return normalize(samples, 0.9);
}

/**
 * Crossfades the last `fade` samples into the first ones and drops them, so the loop runs
 * from its end back into its start without a jump.
 */
export function loopable(samples: Float32Array, fade: number): Float32Array {
  const length = samples.length - fade;
  const loop = samples.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const amount = i / fade;
    // Equal power: uncorrelated noise neither dips nor swells across the join.
    loop[i] =
      samples[i] * Math.sin((amount * Math.PI) / 2) +
      samples[length + i] * Math.cos((amount * Math.PI) / 2);
  }
  return loop;
}

/** Removes any DC offset (which a looping source would turn into a constant push) and normalizes. */
function finish(samples: Float32Array, peak: number): Float32Array {
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) samples[i] -= mean;
  return normalize(samples, peak);
}

function normalize(samples: Float32Array, peak: number): Float32Array {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  if (loudest > 0) for (let i = 0; i < samples.length; i++) samples[i] *= peak / loudest;
  return samples;
}

/** A one-pole low-pass filter at `cutoff` Hz, as a per-sample function. */
function onePole(sampleRate: number, cutoff: number): (input: number) => number {
  const amount = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let state = 0;
  return (input) => (state += amount * (input - state));
}

/** A two-pole resonant band-pass at `centre` Hz with quality `q`, as a per-sample function. */
function resonator(sampleRate: number, centre: number, q: number): (input: number) => number {
  const radius = Math.exp((-Math.PI * centre) / (q * sampleRate));
  const cosine = 2 * radius * Math.cos((2 * Math.PI * centre) / sampleRate);
  const gain = 1 - radius;
  let previous = 0;
  let older = 0;
  return (input) => {
    const output = gain * input + cosine * previous - radius * radius * older;
    older = previous;
    previous = output;
    return output;
  };
}

/** A small seeded PRNG, so every load synthesises the same sounds. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
