// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRACKS } from "@racing/shared";
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
    expect(parent.querySelector(".pacer-chip")!.classList.contains("visible")).toBe(true);
  });

  it("chip shows the Pacer's name", () => {
    hud.showPacerChip(vi.fn(), "ByteRacer");
    expect(parent.querySelector(".pacer-chip")!.textContent).toContain("ByteRacer");
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
    expect(parent.querySelector(".pacer-chip")!.classList.contains("visible")).toBe(false);
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

describe("Hud circuit map", () => {
  let parent: HTMLElement;
  let hud: Hud;

  beforeEach(() => {
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3, undefined, TRACKS[0]);
  });
  afterEach(() => parent.remove());

  const remoteDots = () =>
    [...parent.querySelectorAll<SVGCircleElement>(".hud-map-remote")].map((dot) => [
      dot.getAttribute("cx"),
      dot.getAttribute("cy"),
    ]);

  it("draws one marker per other driver behind the local driver", () => {
    hud.setRemotePositions([
      { id: "p1", x: 10, z: -20 },
      { id: "p2", x: 30.25, z: 40 },
    ]);
    expect(remoteDots()).toEqual([
      ["10.0", "-20.0"],
      ["30.3", "40.0"],
    ]);
    const svg = parent.querySelector(".hud-map svg")!;
    const order = [...svg.querySelectorAll("circle")].map((c) => c.className.baseVal);
    expect(order.at(-1)).toBe("hud-map-driver");
  });

  it("moves an existing marker instead of recreating it", () => {
    hud.setRemotePositions([{ id: "p1", x: 0, z: 0 }]);
    const before = parent.querySelector(".hud-map-remote");
    hud.setRemotePositions([{ id: "p1", x: 5, z: 6 }]);
    expect(parent.querySelector(".hud-map-remote")).toBe(before);
    expect(remoteDots()).toEqual([["5.0", "6.0"]]);
  });

  it("removes the marker of a driver who left", () => {
    hud.setRemotePositions([
      { id: "p1", x: 0, z: 0 },
      { id: "p2", x: 1, z: 1 },
    ]);
    hud.setRemotePositions([{ id: "p2", x: 1, z: 1 }]);
    expect(remoteDots()).toEqual([["1.0", "1.0"]]);
  });

  it("is a no-op without a track", () => {
    const bare = new Hud(makeParent(), "Bare", vi.fn(), 3);
    expect(() => bare.setRemotePositions([{ id: "p1", x: 0, z: 0 }])).not.toThrow();
  });
});

describe("Hud checkpoint bar", () => {
  it("scales the fill to the share of gates collected, writing only on change", () => {
    const parent = makeParent();
    const hud = new Hud(parent, "Test Room", vi.fn(), 4);
    const fill = parent.querySelector<HTMLElement>(".hud-checkpoint-bar i")!;
    const player = {
      id: "me",
      name: "Me",
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      speed: 0,
      laps: 0,
      lastLapMs: null,
      bestLapMs: null,
      lapStartT: 0,
      nextCheckpoint: 1,
      spawns: 0,
    };
    hud.setMyProgress(player);
    expect(fill.style.transform).toBe("scaleX(0.25)");
    const writes = vi.spyOn(fill.style, "transform", "set");
    hud.setMyProgress(player);
    expect(writes).not.toHaveBeenCalled();
    hud.setMyProgress({ ...player, nextCheckpoint: 3 });
    expect(fill.style.transform).toBe("scaleX(0.75)");
    parent.remove();
  });
});
