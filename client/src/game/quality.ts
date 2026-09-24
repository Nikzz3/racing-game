export type QualityTier = "high" | "medium" | "low";
export interface RenderQuality {
  tier: QualityTier;
  /** MSAA is fixed when a context is created, so only a new renderer picks up a change. */
  antialias: boolean;
  maxPixelRatio: number;
  /** How far adaptive resolution may lower a race's pixel ratio before giving up a tier. */
  minPixelRatio: number;
  shadows: boolean;
  anisotropy: number;
}

// The e2e suite renders under software WebGL, where the shadow pass and MSAA
// dominate frame time and the seam's per-frame step cap turns slow frames into
// slow laps (docs/agents/e2e-testing.md). Nothing in the suite asserts on either.
export const CHEAP_RENDER = Boolean(import.meta.env.VITE_E2E);

// MSAA is nearly free on Apple's tile-based GPUs but roughly doubles frame time on
// Intel and AMD integrated graphics, which also pay heavily for pixel ratio and
// anisotropic filtering of the ground at grazing angles.
const TIERS: Record<QualityTier, RenderQuality> = {
  high: {
    tier: "high",
    antialias: true,
    maxPixelRatio: 1.75,
    minPixelRatio: 1,
    shadows: true,
    anisotropy: 4,
  },
  medium: {
    tier: "medium",
    antialias: false,
    maxPixelRatio: 1.5,
    minPixelRatio: 1,
    shadows: true,
    anisotropy: 2,
  },
  low: {
    tier: "low",
    antialias: false,
    maxPixelRatio: 1,
    minPixelRatio: 0.75,
    shadows: false,
    anisotropy: 1,
  },
};
const ORDER: QualityTier[] = ["low", "medium", "high"];
const STORAGE_KEY = "racer-quality";

/** The starting tier for a WebGL renderer string (UNMASKED_RENDERER_WEBGL where exposed). */
export function tierForRenderer(renderer: string): QualityTier {
  if (/swiftshader|llvmpipe|softpipe|basic render|software/i.test(renderer)) return "low";
  // Entry-level laptop GeForces and the integrated "Radeon RX Vega N Graphics".
  if (/geforce (mx|\d+mx)|radeon\S* rx vega \d+ graphics/i.test(renderer)) return "medium";
  if (/apple (m\d|gpu)|nvidia|geforce|quadro|radeon\S* (rx|pro)\b|\barc\S* [ab]\d/i.test(renderer))
    return "high";
  return "medium";
}

let gpu = "";
let current: RenderQuality | undefined;

/** Settings every WebGLRenderer should be created with; stable until `downgradeQuality()`. */
export function renderQuality(): RenderQuality {
  if (current) return current;
  if (CHEAP_RENDER) return (current = TIERS.low);
  gpu = rendererName();
  const detected = tierForRenderer(gpu);
  const saved = savedTier();
  const tier = saved && ORDER.indexOf(saved) < ORDER.indexOf(detected) ? saved : detected;
  console.info(`Render quality: ${tier} (${gpu || "unknown GPU"})`);
  return (current = TIERS[tier]);
}

/**
 * Start later renderers one tier lower, and remember that for this GPU until the
 * browser session ends: a slow session (thermals, a busy CPU) is not a verdict for good.
 */
export function downgradeQuality(): void {
  const lower = ORDER[ORDER.indexOf(renderQuality().tier) - 1];
  if (!lower) return;
  current = TIERS[lower];
  console.info(`Render quality lowered to ${lower} for the next race`);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ gpu, tier: lower }));
  } catch {
    // Without storage the downgrade lasts until the page reloads.
  }
}

/** A downgrade only applies to the GPU it was measured on. */
function savedTier(): QualityTier | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as {
      gpu?: string;
      tier?: QualityTier;
    } | null;
    return saved?.gpu === gpu && saved.tier && ORDER.includes(saved.tier) ? saved.tier : null;
  } catch {
    return null;
  }
}

function rendererName(): string {
  if (typeof WebGL2RenderingContext === "undefined") return "";
  // Ask for the same GPU the race renderer will, then release the context at once.
  const gl = document
    .createElement("canvas")
    .getContext("webgl2", { powerPreference: "high-performance" });
  if (!gl) return "";
  let name = String(gl.getParameter(gl.RENDERER));
  // Chromium and Safari mask RENDERER; Firefox reports a sanitized real name there.
  if (/webkit webgl/i.test(name)) {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return name;
}

const WARM_UP_MS = 2000;
const WINDOW_MS = 2000;
const COOLDOWN_MS = 1000;
/** Longer gaps are a hidden tab or a one-off stall, not a frame rate. */
const PAUSE_MS = 250;
/** Below 50 fps for most of a window. */
const SLOW_MS = 20;
/** Under a 30 fps cap (Chrome's Energy Saver) the typical frame takes two refreshes... */
const CAPPED_MEDIAN_MS = 36;
/** ...and hardly any frame is faster, however much the timing jitters. */
const CAPPED_FAST_MS = 28;
const STEP = 0.85;
/** Giving up a tier lasts across races, so it takes this many slow windows in a row at the floor. */
const FLOOR_WINDOWS = 3;

/**
 * Watches a race's frame pacing, fed every rAF timestamp, and says when to draw
 * fewer pixels: a lower pixel ratio, or "downgrade" once the floor is reached and
 * frames are still slow. It never raises the ratio, so the image does not pump.
 */
export class AdaptiveResolution {
  private previous: number | null = null;
  private resumeAt = 0;
  private windowStart = 0;
  private intervals: number[] = [];
  private slowAtFloor = 0;
  private probed = false;
  private finished = false;

  constructor(
    private pixelRatio: number,
    private readonly floor: number,
  ) {}

  frame(now: number): number | "downgrade" | null {
    const previous = this.previous;
    this.previous = now;
    if (this.finished) return null;
    if (previous === null) {
      this.resumeAt = now + WARM_UP_MS;
      return null;
    }
    const interval = now - previous;
    if (interval > PAUSE_MS) {
      this.intervals = [];
      this.resumeAt = Math.max(this.resumeAt, now + COOLDOWN_MS);
    }
    if (now < this.resumeAt) return null;
    if (!this.intervals.length) this.windowStart = previous;
    this.intervals.push(interval);
    if (now - this.windowStart < WINDOW_MS) return null;
    const sorted = this.intervals.sort((a, b) => a - b);
    this.intervals = [];
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1];
    // A 30 fps cap and a GPU just over a 60 Hz budget look alike: nearly every frame
    // takes two refreshes. One step tells them apart, since under a cap it changes
    // nothing; after that a cap is left alone, and it never costs a tier.
    const capped = p10 >= CAPPED_FAST_MS && median <= CAPPED_MEDIAN_MS;
    if (p90 <= SLOW_MS || (capped && this.probed)) {
      this.slowAtFloor = 0;
      return null;
    }
    if (capped) this.probed = true;
    if (this.pixelRatio > this.floor) {
      this.resumeAt = now + COOLDOWN_MS;
      this.pixelRatio = Math.max(this.floor, Math.round(this.pixelRatio * STEP * 100) / 100);
      return this.pixelRatio;
    }
    if (capped) return null;
    if (++this.slowAtFloor < FLOOR_WINDOWS) return null;
    this.finished = true;
    return "downgrade";
  }
}
