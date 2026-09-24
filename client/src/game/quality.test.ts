// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdaptiveResolution, tierForRenderer } from "./quality";

/** A WebGL context that masks RENDERER, as Chromium does, and unmasks it to `name`. */
function gpu(name: string) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    RENDERER: 1,
    getParameter: (parameter: number) => (parameter === 1 ? "WebKit WebGL" : name),
    getExtension: (extension: string) =>
      extension === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 2 } : null,
  } as never);
}
const load = () => import("./quality");

/** Feed frames cycling through `pattern` (ms) until `seconds`, returning every decision. */
function run(
  monitor: AdaptiveResolution,
  pattern: number[],
  seconds: number,
  clock = { now: 0 },
): (number | "downgrade")[] {
  const decisions: (number | "downgrade")[] = [];
  for (let i = 0; clock.now < seconds * 1000; i++) {
    const decision = monitor.frame(clock.now);
    if (decision !== null) decisions.push(decision);
    clock.now += pattern[i % pattern.length];
  }
  return decisions;
}

describe("tierForRenderer", () => {
  it.each([
    [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    ],
    [
      "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ],
    ["llvmpipe (LLVM 17.0.6, 256 bits)"],
  ])("puts software rendering on low: %s", (renderer) => {
    expect(tierForRenderer(renderer)).toBe("low");
  });

  it.each([
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"],
    ["Apple GPU"],
    [
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ],
    ["ANGLE (NVIDIA, NVIDIA Quadro T1000 Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["AMD Radeon Pro 5500M OpenGL Engine"],
    ["ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"],
  ])("puts Apple and discrete GPUs on high: %s", (renderer) => {
    expect(tierForRenderer(renderer)).toBe("high");
  });

  it.each([
    ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics, Unspecified Version)"],
    ["ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)"],
    ["Mali-G78"],
    [""],
  ])("puts integrated, entry-level and unknown GPUs on medium: %s", (renderer) => {
    expect(tierForRenderer(renderer)).toBe("medium");
  });
});

describe("renderQuality", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("WebGL2RenderingContext", class {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the unmasked renderer once and keeps the tier stable", async () => {
    const getContext = gpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)");
    const { renderQuality } = await load();
    expect(renderQuality()).toMatchObject({ tier: "high", antialias: true, shadows: true });
    renderQuality();
    expect(getContext).toHaveBeenCalledOnce();
  });

  it("starts later renderers, and later visits on the same GPU, one tier lower", async () => {
    gpu("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)");
    const first = await load();
    expect(first.renderQuality().tier).toBe("medium");
    first.downgradeQuality();
    expect(first.renderQuality()).toMatchObject({ tier: "low", shadows: false });
    first.downgradeQuality();
    expect(first.renderQuality().tier).toBe("low");

    vi.resetModules();
    expect((await load()).renderQuality().tier).toBe("low");
  });

  it("ignores a downgrade measured on a different GPU", async () => {
    gpu("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)");
    (await load()).downgradeQuality();
    vi.resetModules();
    gpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)");
    expect((await load()).renderQuality().tier).toBe("high");
  });
});

describe("AdaptiveResolution", () => {
  it("leaves a smooth 60 fps race alone", () => {
    expect(run(new AdaptiveResolution(1.5, 1), [16.7], 60)).toEqual([]);
  });

  it("ignores a steady 30 fps cadence, which is a frame-rate cap rather than GPU load", () => {
    expect(run(new AdaptiveResolution(1.5, 1), [33.3], 60)).toEqual([]);
  });

  it("steps the pixel ratio down to the floor, then asks for a lower tier once", () => {
    // GPU-bound under vsync: frames alternate between one and two refreshes.
    const decisions = run(new AdaptiveResolution(1.5, 1), [16.7, 33.3, 33.3], 60);
    expect(decisions).toEqual([1.27, 1.08, 1, "downgrade"]);
  });

  it("gives up a tier only after frames stay slow at the floor", () => {
    const monitor = new AdaptiveResolution(1, 1);
    const clock = { now: 0 };
    run(monitor, [16.7], 5, clock);
    // A few slow seconds, e.g. another app busy for a moment, are not a verdict on the GPU.
    expect(run(monitor, [16.7, 33.3], 8, clock)).toEqual([]);
    expect(run(monitor, [16.7], 20, clock)).toEqual([]);
    expect(run(monitor, [16.7, 33.3], 27, clock)).toEqual(["downgrade"]);
  });

  it("treats a steady cadence well below 30 fps as load", () => {
    expect(run(new AdaptiveResolution(1.25, 1), [50], 20)[0]).toBe(1.06);
  });

  it("ignores the warm-up and waits a full window before judging", () => {
    const monitor = new AdaptiveResolution(1.5, 1);
    const clock = { now: 0 };
    // Two slow seconds straight after the first frame are shader and texture warm-up.
    expect(run(monitor, [100], 2, clock)).toEqual([]);
    expect(run(monitor, [16.7], 4, clock)).toEqual([]);
    expect(run(monitor, [16.7, 33.3, 33.3], 5.9, clock)).toEqual([]);
    expect(run(monitor, [16.7, 33.3, 33.3], 6.1, clock)).toEqual([1.27]);
  });

  it("does not count a hidden tab or a single stall as slow frames", () => {
    const monitor = new AdaptiveResolution(1.5, 1);
    const clock = { now: 0 };
    run(monitor, [16.7], 3, clock);
    clock.now += 5000;
    expect(run(monitor, [16.7], 20, clock)).toEqual([]);
  });

  it("waits out a cooldown after each step so the resize is not judged", () => {
    const decisions: [number, number | "downgrade"][] = [];
    const monitor = new AdaptiveResolution(1.75, 1);
    for (let now = 0, i = 0; now < 30_000; now += [16.7, 33.3][i++ % 2]) {
      const decision = monitor.frame(now);
      if (decision !== null) decisions.push([now, decision]);
    }
    const times = decisions.map(([now]) => now);
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(2900);
    expect(decisions.map(([, decision]) => decision)).toEqual([1.49, 1.27, 1.08, 1, "downgrade"]);
  });
});
