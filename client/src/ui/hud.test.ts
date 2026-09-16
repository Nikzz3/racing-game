// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hud } from "./hud";

function makeParent(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("Hud pacer chip", () => {
  let parent: HTMLElement;
  let hud: Hud;

  beforeEach(() => {
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3);
  });
  afterEach(() => parent.remove());

  it("pacer chip renders hidden inside the top-left HUD panel", () => {
    const chip = parent.querySelector(".hud-top-left .pacer-chip")!;
    expect(chip).not.toBeNull();
    expect(chip.classList.contains("visible")).toBe(false);
  });

  it("showPacerChip makes the chip visible", () => {
    hud.showPacerChip(vi.fn());
    expect(
      parent.querySelector(".pacer-chip")!.classList.contains("visible"),
    ).toBe(true);
  });

  it("chip shows the Pacer's name", () => {
    hud.showPacerChip(vi.fn(), "ByteRacer");
    expect(parent.querySelector(".pacer-chip")!.textContent).toContain(
      "ByteRacer",
    );
  });

  it("chip shows a dismiss button with label ✕", () => {
    hud.showPacerChip(vi.fn());
    const btn = parent.querySelector<HTMLButtonElement>(".pacer-chip-dismiss");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("✕");
  });

  it("clicking dismiss calls onDismiss callback", () => {
    const onDismiss = vi.fn();
    hud.showPacerChip(onDismiss);
    parent.querySelector<HTMLButtonElement>(".pacer-chip-dismiss")!.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("hidePacerChip hides the chip", () => {
    hud.showPacerChip(vi.fn());
    hud.hidePacerChip();
    expect(
      parent.querySelector(".pacer-chip")!.classList.contains("visible"),
    ).toBe(false);
  });

  it("showPacerChip replaces the previous dismiss handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    hud.showPacerChip(first);
    hud.showPacerChip(second);
    parent.querySelector<HTMLButtonElement>(".pacer-chip-dismiss")!.click();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
