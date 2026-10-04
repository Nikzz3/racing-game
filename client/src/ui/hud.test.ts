// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  medalTimes,
  TRACKS,
  type PlayerSnapshot,
  type RaceEntrant,
  type RaceState,
} from "@racing/shared";
import { Hud } from "./hud";

function makeParent(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

/** A circuit-map marker's position, in the circuit units the HUD hands to CSS. */
function position(dot: HTMLElement): string[] {
  return [dot.style.getPropertyValue("--x"), dot.style.getPropertyValue("--z")];
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
    [...parent.querySelectorAll<HTMLElement>(".hud-map-remote")].map(position);
  const driver = () => parent.querySelector<HTMLElement>(".hud-map-driver")!;

  it("starts the local driver on the first track sample", () => {
    const start = TRACKS[0].samples[0];
    expect(position(driver())).toEqual([String(Math.round(start.x)), String(Math.round(start.z))]);
  });

  it("moves the local driver in whole circuit units, writing only on change", () => {
    hud.setPosition(12.4, -7.6);
    expect(position(driver())).toEqual(["12", "-8"]);
    const writes = vi.spyOn(driver().style, "setProperty");
    hud.setPosition(11.6, -8.4);
    expect(writes).not.toHaveBeenCalled();
    hud.setPosition(11.6, -9);
    expect(writes).toHaveBeenCalledOnce();
    expect(position(driver())).toEqual(["12", "-9"]);
  });

  it("keeps the track outline out of the per-frame markers", () => {
    const svg = parent.querySelector(".hud-map svg")!;
    const before = svg.innerHTML;
    hud.setPosition(40, 50);
    hud.setRemotePositions([{ id: "p1", x: 10, z: -20 }]);
    expect(svg.innerHTML).toBe(before);
  });

  it("draws one marker per other driver behind the local driver", () => {
    hud.setRemotePositions([
      { id: "p1", x: 10, z: -20 },
      { id: "p2", x: 30.25, z: 40 },
    ]);
    expect(remoteDots()).toEqual([
      ["10", "-20"],
      ["30", "40"],
    ]);
    const markers = [...parent.querySelectorAll(".hud-map-dot")];
    expect(markers.at(-1)).toBe(driver());
  });

  it("moves an existing marker instead of recreating it", () => {
    hud.setRemotePositions([{ id: "p1", x: 0, z: 0 }]);
    const before = parent.querySelector(".hud-map-remote");
    hud.setRemotePositions([{ id: "p1", x: 5, z: 6 }]);
    expect(parent.querySelector(".hud-map-remote")).toBe(before);
    expect(remoteDots()).toEqual([["5", "6"]]);
  });

  it("removes the marker of a driver who left", () => {
    hud.setRemotePositions([
      { id: "p1", x: 0, z: 0 },
      { id: "p2", x: 1, z: 1 },
    ]);
    hud.setRemotePositions([{ id: "p2", x: 1, z: 1 }]);
    expect(remoteDots()).toEqual([["1", "1"]]);
  });

  it("is a no-op without a track", () => {
    const bare = new Hud(makeParent(), "Bare", vi.fn(), 3);
    expect(() => bare.setRemotePositions([{ id: "p1", x: 0, z: 0 }])).not.toThrow();
    expect(() => bare.setPosition(0, 0)).not.toThrow();
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

describe("Hud lap timer", () => {
  let parent: HTMLElement;
  let hud: Hud;
  let lap: HTMLElement;

  beforeEach(() => {
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3);
    lap = parent.querySelector<HTMLElement>(".hud-cur-lap")!;
  });
  afterEach(() => parent.remove());

  it("redraws a running lap at most every 50ms", () => {
    hud.setCurrentLap(1_000);
    expect(lap.textContent).toBe("0:01.000");
    hud.setCurrentLap(1_016);
    hud.setCurrentLap(1_049);
    expect(lap.textContent).toBe("0:01.000");
    hud.setCurrentLap(1_050);
    expect(lap.textContent).toBe("0:01.050");
    hud.setCurrentLap(1_067);
    expect(lap.textContent).toBe("0:01.050");
    hud.setCurrentLap(1_117);
    expect(lap.textContent).toBe("0:01.117");
  });

  it("shows a restarted or cleared clock at once", () => {
    hud.setCurrentLap(61_234);
    hud.setCurrentLap(12);
    expect(lap.textContent).toBe("0:00.012");
    hud.setCurrentLap(null);
    expect(lap.textContent).toBe("--:--.---");
    hud.setCurrentLap(20);
    expect(lap.textContent).toBe("0:00.020");
  });
});

describe("Hud checkpoint penalty", () => {
  afterEach(() => vi.useRealTimers());

  it("flashes the penalty, then hides it", () => {
    vi.useFakeTimers();
    const parent = makeParent();
    const hud = new Hud(parent, "Test Room", vi.fn(), 3);
    const warning = parent.querySelector(".cp-miss-warn")!;
    hud.flashCheckpointPenalty(4000);
    expect(warning.classList.contains("visible")).toBe(true);
    expect(warning.textContent).toContain("+4s penalty");
    vi.advanceTimersByTime(2500);
    expect(warning.classList.contains("visible")).toBe(false);
    parent.remove();
  });
});

function entrant(id: string, extra: Partial<RaceEntrant> = {}): RaceEntrant {
  return { id, name: id.toUpperCase(), slot: 0, laps: 1, status: "racing", ...extra };
}

describe("Hud race", () => {
  let parent: HTMLElement;
  let hud: Hud;
  const controls = { start: vi.fn(), cycle: vi.fn() };

  const field = (overrides: Partial<RaceState> = {}): RaceState => ({
    format: "race",
    phase: "racing",
    laps: 3,
    goT: 10_000,
    entrants: [
      entrant("a", { laps: 3, status: "finished", finishMs: 95_250 }),
      entrant("me"),
      entrant("pacer:0", { name: "Pete", pacer: true }),
      entrant("b", { status: "out" }),
    ],
    ...overrides,
  });
  const $ = (selector: string) => parent.querySelector<HTMLElement>(selector)!;
  const texts = (selector: string) =>
    [...parent.querySelectorAll(selector)].map((element) => element.textContent);
  const visible = (selector: string) => $(selector).classList.contains("visible");

  beforeEach(() => {
    controls.start.mockReset();
    controls.cycle.mockReset();
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3, vi.fn(), undefined, controls);
  });
  afterEach(() => parent.remove());

  it("offers to start a race or a knockout only while the Room has no race running", () => {
    $(".hud-start-race").click();
    $(".hud-start-knockout").click();
    expect(controls.start.mock.calls).toEqual([["race"], ["knockout"]]);
    for (const [phase, offered] of [
      ["countdown", false],
      ["racing", false],
      ["results", true],
    ] as const) {
      hud.setRace(field({ phase }), "me");
      expect([$(".hud-start-race").hidden, $(".hud-start-knockout").hidden]).toEqual([
        !offered,
        !offered,
      ]);
    }
    hud.setRace(null, "me");
    expect($(".hud-start-race").hidden).toBe(false);
  });

  it("swaps the best laps for the race order: position, name and status per entrant", () => {
    hud.setRace(field(), "me");
    expect($(".hud-standings").hidden).toBe(true);
    expect($(".race-standings").hidden).toBe(false);
    expect($(".race-standings h3").textContent).toBe("RACE");
    expect(texts(".race-standings td.rs-pos")).toEqual(["1", "2", "3", "4"]);
    expect(texts(".race-standings td.rs-name")).toEqual(["A", "ME", "Pete", "B"]);
    expect(texts(".race-standings td.rs-status")).toEqual(["1:35.250", "L1/3", "L1/3", "DNF"]);
    expect([...parent.querySelectorAll(".race-standings tr")].map((tr) => tr.className)).toEqual([
      "finished",
      "racing me",
      "racing pacer",
      "out",
    ]);
    hud.setRace(field({ format: "knockout" }), "me");
    expect($(".race-standings h3").textContent).toBe("KNOCKOUT");
    expect(texts(".race-standings td.rs-status").at(-1)).toBe("OUT");
    hud.setRace(field({ phase: "results" }), "me");
    expect([$(".hud-standings").hidden, $(".race-standings").hidden]).toEqual([true, true]);
    hud.setRace(null, "me");
    expect([$(".hud-standings").hidden, $(".race-standings").hidden]).toEqual([false, true]);
  });

  it("shows the driver's position and race lap while racing, and the session's laps again after", () => {
    const me: PlayerSnapshot = {
      id: "me",
      name: "Me",
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      speed: 0,
      laps: 7,
      lastLapMs: null,
      bestLapMs: null,
      lapStartT: null,
      nextCheckpoint: 0,
      spawns: 0,
    };
    hud.setRace(field(), "me");
    expect($(".race-position").hidden).toBe(false);
    expect($(".race-position").textContent).toBe("P2/4");
    hud.setMyProgress(me);
    expect($(".hud-lap").textContent).toBe("LAP 2/3");
    hud.setRace(field(), "a");
    expect($(".race-position").hidden).toBe(true);
    expect($(".hud-lap").textContent).toBe("LAP 3/3");
    hud.setRace(null, "me");
    hud.setMyProgress(me);
    expect($(".hud-lap").textContent).toBe("LAP 7");
  });

  it("counts down to GO in whole seconds, then shows GO! for a second", () => {
    hud.setRace(field({ phase: "countdown" }), "me");
    const shown = (serverNow: number) => {
      hud.setRaceClock(serverNow);
      return visible(".race-countdown") ? $(".race-countdown").textContent : null;
    };
    expect([6_900, 7_000, 8_000, 9_999, 10_000, 10_999, 11_000].map(shown)).toEqual([
      "3",
      "3",
      "2",
      "1",
      "GO!",
      "GO!",
      null,
    ]);
    hud.setRace(null, "me");
    expect(shown(10_000)).toBeNull();
  });

  it("puts up the results with the final order and the wait for free driving", () => {
    hud.setRace(field({ format: "knockout", phase: "results", deadlineT: 30_000 }), "me");
    hud.setRaceClock(20_001);
    expect(visible(".race-results")).toBe(true);
    expect($(".race-results h2").textContent).toBe("KNOCKOUT RESULTS");
    expect(texts(".race-results-list .rr-name")).toEqual(["A", "ME", "Pete", "B"]);
    expect(texts(".race-results-list .rr-time")).toEqual(["1:35.250", "L1/3", "L1/3", "OUT"]);
    expect(parent.querySelector(".race-results-list li.me .rr-pos")!.textContent).toBe("2");
    expect($(".race-results-return").textContent).toBe("Free driving in 10s");
    hud.setRace(null, "me");
    expect(visible(".race-results")).toBe(false);
  });

  it("names the watched car while spectating and steps through the cars from the banner", () => {
    hud.setSpectating("Pete");
    expect(visible(".spectator-banner")).toBe(true);
    expect($(".spectator-banner").textContent).toContain("SPECTATING");
    expect($(".spectator-target").textContent).toBe("Pete");
    parent.querySelector<HTMLElement>("[aria-label='Previous car']")!.click();
    parent.querySelector<HTMLElement>("[aria-label='Next car']")!.click();
    expect(controls.cycle.mock.calls).toEqual([[-1], [1]]);
    hud.setSpectating(null);
    expect(visible(".spectator-banner")).toBe(false);
  });

  it("turns Respawn off and on", () => {
    const respawn = parent.querySelector<HTMLButtonElement>(".hud-respawn")!;
    hud.setRespawnEnabled(false);
    expect(respawn.disabled).toBe(true);
    hud.setRespawnEnabled(true);
    expect(respawn.disabled).toBe(false);
  });

  it("marks grid Pacers on the circuit map apart from drivers, and hides a Spectator's own marker", () => {
    const mapped = new Hud(makeParent(), "Map", vi.fn(), 3, undefined, TRACKS[0]);
    mapped.setRemotePositions([{ id: "p1", x: 0, z: 0 }], [{ id: "pacer:0", x: 5, z: 5 }]);
    expect(document.querySelectorAll(".hud-map-remote")).toHaveLength(2);
    expect(document.querySelectorAll(".hud-map-pacer")).toHaveLength(1);
    mapped.setDriverShown(false);
    expect(document.querySelector<HTMLElement>(".hud-map-driver")!.hidden).toBe(true);
    mapped.dispose();
  });
});

describe("Hud medal chip", () => {
  // Sunset Ridge at Medium: Bronze 0:35.700, Silver 0:28.560, Gold 0:25.230, Author 0:23.800.
  const TIMES = medalTimes("sunset-ridge", "medium")!;
  let parent: HTMLElement;
  let hud: Hud;
  const chip = () => parent.querySelector<HTMLElement>(".hud-medal")!;

  beforeEach(() => {
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3);
  });
  afterEach(() => parent.remove());

  it("stays hidden on a board without Medal targets", () => {
    expect(chip().hidden).toBe(true);
    hud.setMedal(null, 30_000);
    expect(chip().hidden).toBe(true);
  });

  it("shows an empty slot and the Bronze target before a best lap", () => {
    hud.setMedal(TIMES, null);
    expect(chip().hidden).toBe(false);
    expect(chip().querySelector(".medal-bronze.medal-empty")).not.toBeNull();
    expect(chip().textContent).toBe("NEXT · BRONZE 0:35.700");
  });

  it("shows the Medal the best lap earned and the next target", () => {
    hud.setMedal(TIMES, 27_000);
    expect(chip().querySelector(".medal-silver:not(.medal-empty)")).not.toBeNull();
    expect(chip().textContent).toBe("NEXT · GOLD 0:25.230");
  });

  it("says so once Author is earned, with the best lap", () => {
    hud.setMedal(TIMES, 23_512);
    expect(chip().querySelector(".medal-author")).not.toBeNull();
    expect(chip().textContent).toBe("AUTHOR EARNED 0:23.512");
  });
});

describe("Hud medal award", () => {
  let parent: HTMLElement;
  let hud: Hud;

  beforeEach(() => {
    vi.useFakeTimers();
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3);
  });
  afterEach(() => {
    vi.useRealTimers();
    parent.remove();
  });

  it("celebrates the tier with the lap time and the cars it unlocked", () => {
    hud.awardMedal("gold", 25_120, ["race", "police"]);
    const award = parent.querySelector(".medal-award")!;
    expect(award.classList).toContain("medal-award-gold");
    expect(award.querySelector(".medal-badge.medal-gold")).not.toBeNull();
    expect(award.querySelector(".medal-award-title")!.textContent).toBe("Gold medal");
    expect(award.querySelector(".medal-award-time")!.textContent).toBe("0:25.120");
    expect(award.querySelector(".medal-award-unlock")!.textContent).toBe(
      "New cars unlocked: Race, Police",
    );
  });

  it("leaves the unlock line out when no car unlocked", () => {
    hud.awardMedal("author", 23_700, []);
    expect(parent.querySelector(".medal-award-author .medal-award-unlock")).toBeNull();
  });

  it("replaces an earlier award and clears itself after about four seconds", () => {
    hud.awardMedal("silver", 28_000, []);
    vi.advanceTimersByTime(2000);
    hud.awardMedal("gold", 25_000, ["police"]);
    expect([...parent.querySelectorAll(".medal-award")].map((a) => a.className)).toEqual([
      "medal-award medal-award-gold",
    ]);
    // The first award's timer must not take the second one down with it.
    vi.advanceTimersByTime(2500);
    expect(parent.querySelector(".medal-award-gold")).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(parent.querySelector(".medal-award")).toBeNull();
  });
});

describe("Hud rival prompt", () => {
  let parent: HTMLElement;
  let hud: Hud;
  const prompt = () => parent.querySelector(".rival-prompt");

  beforeEach(() => {
    vi.useFakeTimers();
    parent = makeParent();
    hud = new Hud(parent, "Test Room", vi.fn(), 3);
  });
  afterEach(() => {
    vi.useRealTimers();
    parent.remove();
  });

  it("offers the Rival with a button that races them once", () => {
    const onRace = vi.fn();
    hud.showRivalPrompt("Ana <3", 24_440, onRace);
    expect(prompt()!.textContent).toContain("NEXT RIVAL · Ana <3 · 0:24.440");
    prompt()!.querySelector("button")!.click();
    hud.acceptRivalPrompt();
    expect(onRace).toHaveBeenCalledOnce();
    expect(prompt()).toBeNull();
  });

  it("keeps only the newest offer, and withdraws it after a while", () => {
    const first = vi.fn();
    const second = vi.fn();
    hud.showRivalPrompt("Ana", 24_440, first);
    hud.showRivalPrompt("Ben", 24_100, second);
    expect(parent.querySelectorAll(".rival-prompt")).toHaveLength(1);
    expect(prompt()!.textContent).toContain("Ben");
    vi.advanceTimersByTime(10_000);
    expect(prompt()).toBeNull();
    hud.acceptRivalPrompt();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
