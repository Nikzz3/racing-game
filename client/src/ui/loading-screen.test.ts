// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadingScreen } from "./loading-screen";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mount() {
  document.body.innerHTML = '<main class="lobby"><button>Choose car</button></main>';
  return new LoadingScreen(document.body);
}

describe("garage loading screen", () => {
  it("reports real download progress, and returns to indeterminate while opening", () => {
    const loading = mount();
    const meter = document.querySelector("progress")!;
    expect(meter.hasAttribute("value")).toBe(false);
    expect(document.querySelector<HTMLElement>(".lobby")!.inert).toBe(true);
    loading.update({ phase: "loading", loaded: 250, total: 1000 });
    expect(meter.value).toBe(250);
    expect(meter.max).toBe(1000);
    expect(document.querySelector(".loading-amount")!.textContent).toBe("25%");
    loading.update({ phase: "ready", loaded: 1000, total: 1000 });
    expect(meter.hasAttribute("value")).toBe(false);
    expect(document.querySelector("[role=status]")!.textContent).toBe("Opening the garage");
    // Finishing the download alone must not uncover an uninitialized scene.
    expect(document.querySelector(".game-loading.is-ready")).toBeNull();
  });

  it("offers a way out on failure and restores the lobby after continuing", () => {
    vi.useFakeTimers();
    const loading = mount();
    loading.update({ phase: "error", loaded: 0, total: 0 });
    expect(document.querySelector<HTMLProgressElement>("progress")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".loading-error-actions")!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-loading-continue]")!.click();
    expect(document.querySelector<HTMLElement>(".lobby")!.inert).toBe(false);
    vi.runAllTimers();
    expect(document.querySelector(".game-loading")).toBeNull();
  });
});
