// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DESKTOP_DOWNLOAD_URL, Lobby, type LobbyCallbacks } from "./lobby";
import {
  CAR_VARIANTS,
  type LeaderboardEntry,
  type ReplayFrame,
  type RoomInfo,
} from "@racing/shared";
import type { ReferenceLap } from "../game/reference-lap";
import { formatMs } from "../util";

// The lobby bakes the AI Reference Lap through buildReferenceLap; mock it so
// tests control the bake's result (and its call count) without running the
// policy harness.
const { buildReferenceLapMock } = vi.hoisted(() => ({
  buildReferenceLapMock: vi.fn(),
}));
vi.mock("../game/reference-lap", () => ({
  buildReferenceLap: buildReferenceLapMock,
}));

const AI_FRAMES: ReplayFrame[] = [
  [0, 0, 0, 0, 0],
  [1000 / 60, 0.5, 0.1, 0.01, 3],
];

function referenceLap(timeMs = 23800): ReferenceLap {
  return {
    name: "AI Record",
    variant: "police",
    track: "sunset-ridge",
    timeMs,
    frames: AI_FRAMES,
  };
}

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    name: "Alice",
    timeMs: 60000,
    date: "2026-01-01",
    hasReplay: false,
    difficulty: "medium",
    track: "sunset-ridge",
    ...overrides,
  };
}

let parent: HTMLElement;
let lobby: Lobby;
let cbs: LobbyCallbacks;

/** Mounts a fresh Lobby into `parent`; call again in a test to remount. */
function mount(): Lobby {
  cbs = {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onReplay: vi.fn(),
    onReferenceLap: vi.fn(),
    onVariantChange: vi.fn(),
  };
  lobby = new Lobby(parent, cbs);
  return lobby;
}
function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  return parent.querySelector<T>(selector)!;
}
function click(selector: string): void {
  q<HTMLButtonElement>(selector).click();
}
function press(el: HTMLElement, key: string): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}
function active(selector: string): boolean {
  return q(selector).classList.contains("active");
}
function checked(selector: string): string | null {
  return q(selector).getAttribute("aria-checked");
}
function picker(): HTMLSelectElement {
  return q<HTMLSelectElement>(".pacer-select");
}
function pickPacer(value: string): void {
  picker().value = value;
  picker().dispatchEvent(new Event("change"));
}
function optionTexts(): string[] {
  return [...picker().options].map((o) => o.textContent!);
}
function names(): string[] {
  return [...parent.querySelectorAll(".lb-list .lb-name")].map(
    (n) => n.textContent!,
  );
}
function submitForm(): void {
  q<HTMLFormElement>(".create-form").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}
/** Walks to the settings screen the way a player does. */
function enterSettings(): void {
  click("[data-select-car]");
  click("[data-select-track]");
}
const track = (slug: string) => `button[data-track="${slug}"]`;
const diff = (d: string) => `button[data-diff="${d}"]`;
const boardDiff = (d: string) => `.board-diff-opt[data-board-diff="${d}"]`;
const card = (variant: string) => `.garage-card[data-variant="${variant}"]`;

beforeEach(() => {
  buildReferenceLapMock.mockReset();
  buildReferenceLapMock.mockReturnValue(referenceLap());
  localStorage.clear();
  parent = document.createElement("div");
  document.body.appendChild(parent);
});
afterEach(() => {
  parent.remove();
  localStorage.clear();
  Reflect.deleteProperty(window, "desktop");
});

describe("Lobby track selector cards", () => {
  beforeEach(mount);

  it("renders a card for each registered track", () => {
    expect(q(track("sunset-ridge"))).not.toBeNull();
    expect(q(track("stormhaven"))).not.toBeNull();
  });

  it("Sunset Ridge card is active by default", () => {
    expect(active(track("sunset-ridge"))).toBe(true);
    expect(active(track("stormhaven"))).toBe(false);
  });

  it("clicking Stormhaven marks it active and deactivates Sunset Ridge", () => {
    click(track("stormhaven"));
    expect(active(track("stormhaven"))).toBe(true);
    expect(active(track("sunset-ridge"))).toBe(false);
  });

  it("track cards contain the track name", () => {
    expect(q(track("sunset-ridge")).textContent).toContain(
      "Sunset Ridge Circuit",
    );
    expect(q(track("stormhaven")).textContent).toContain("Stormhaven Circuit");
  });

  it("selecting Stormhaven filters the leaderboard to Stormhaven entries", () => {
    lobby.setLeaderboard([
      entry(),
      entry({ name: "Bob", timeMs: 65000, track: "stormhaven" }),
    ]);
    click(track("stormhaven"));
    expect(names()).toEqual(["Bob"]);
  });
});

describe("Lobby unified difficulty selector", () => {
  beforeEach(mount);

  it("has a unified difficulty button for each difficulty", () => {
    for (const d of ["easy", "medium", "hard"])
      expect(q(diff(d))).not.toBeNull();
  });

  it("the Records board has its own difficulty radios that never carry data-diff", () => {
    const boardRadios = parent.querySelectorAll("button[data-board-diff]");
    expect(boardRadios).toHaveLength(3);
    boardRadios.forEach((b) => expect(b.hasAttribute("data-diff")).toBe(false));
  });

  it("clicking hard filters the leaderboard to hard entries", () => {
    lobby.setLeaderboard([
      entry(),
      entry({ name: "Bob", timeMs: 55000, difficulty: "hard" }),
    ]);
    click(diff("hard"));
    expect(names()).toEqual(["Bob"]);
  });
});

describe("Lobby create-room callback", () => {
  beforeEach(mount);

  it("submitting the form calls onCreate with default track (sunset-ridge) and difficulty (medium)", () => {
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "sunset-ridge",
      "medium",
    );
  });

  it("onCreate includes selected track after switching to Stormhaven", () => {
    click(track("stormhaven"));
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "stormhaven",
      "medium",
    );
  });

  it("onCreate includes selected difficulty after switching to hard", () => {
    click(diff("hard"));
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "sunset-ridge",
      "hard",
    );
  });
});

describe("Lobby room list tracks", () => {
  beforeEach(mount);

  it.each([
    ["stormhaven", "Stormhaven Circuit"],
    ["sunset-ridge", "Sunset Ridge Circuit"],
  ] as const)("room rows show the track name for %s", (slug, name) => {
    lobby.setRooms([
      {
        id: "r1",
        name: "Test Room",
        players: 2,
        difficulty: "medium",
        track: slug,
      } as RoomInfo,
    ]);
    expect(q(".room-list").textContent).toContain(name);
  });
});

describe("Lobby Pacer arming UX", () => {
  const replayEntry = entry({ timeMs: 62340, hasReplay: true });
  const noReplayEntry = entry({
    name: "Bob",
    timeMs: 65000,
    date: "2026-01-02",
  });
  const replayEntry2 = entry({
    name: "Carol",
    timeMs: 63000,
    date: "2026-01-03",
    hasReplay: true,
  });

  beforeEach(() => {
    mount().setLeaderboard([replayEntry, noReplayEntry, replayEntry2]);
  });

  /** Selects the option naming `name` (or "No Pacer" when null) and fires change. */
  function pickByName(name: string | null): void {
    pickPacer(
      name === null
        ? "-1"
        : [...picker().options].find((o) => o.textContent!.includes(name))!
            .value,
    );
  }

  it("picker lives in the Starting Grid panel", () => {
    expect(q(".panel-rooms .pacer-select")).not.toBeNull();
  });

  it("non-replay row shows no Watch button", () => {
    const bobRow = [...parent.querySelectorAll(".lb-list li")].find((li) =>
      li.textContent!.includes("Bob"),
    );
    expect(bobRow!.querySelector("button[data-replay]")).toBeNull();
  });

  it('armedPacer is null and "No Pacer" selected initially', () => {
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
  });

  it("offers only replay-bearing entries", () => {
    const texts = optionTexts().join("\n");
    expect(texts).toContain("Alice");
    expect(texts).toContain("Carol");
    expect(texts).not.toContain("Bob");
  });

  it("options show a formatted lap time", () => {
    expect(optionTexts().find((t) => t.includes("Alice"))).toContain("1:02");
  });

  it('picking an entry arms it as a kind:"replay" Pacer', () => {
    pickByName("Alice");
    expect(lobby.armedPacer).toEqual({
      kind: "replay",
      name: "Alice",
      track: "sunset-ridge",
      difficulty: "medium",
      entry: replayEntry,
    });
  });

  it('picking "No Pacer" clears the armed entry', () => {
    pickByName("Alice");
    pickByName(null);
    expect(lobby.armedPacer).toBeNull();
  });

  it("picking a new entry replaces the previous one", () => {
    pickByName("Alice");
    pickByName("Carol");
    expect(lobby.armedPacer).toMatchObject({
      kind: "replay",
      entry: replayEntry2,
    });
  });

  it("only offers entries matching selected Track and Difficulty", () => {
    lobby.setLeaderboard([
      replayEntry,
      entry({ name: "Dave", hasReplay: true, track: "stormhaven" }),
    ]);
    const texts = optionTexts().join("\n");
    expect(texts).toContain("Alice");
    expect(texts).not.toContain("Dave");
  });

  it("switching Track clears the armed Pacer and resets the picker", () => {
    pickByName("Alice");
    click(track("stormhaven"));
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
  });

  it("the armed Pacer survives a leaderboard refresh with new entry objects", () => {
    pickByName("Alice");
    lobby.setLeaderboard([{ ...replayEntry }, noReplayEntry, replayEntry2]);
    expect(lobby.armedPacer).toMatchObject({
      kind: "replay",
      entry: replayEntry,
    });
    expect(picker().value).not.toBe("-1");
  });

  it("is disabled when no entry has a replay and the AI is ineligible", () => {
    click(diff("hard"));
    lobby.setLeaderboard([{ ...noReplayEntry, difficulty: "hard" }]);
    expect(picker().disabled).toBe(true);
  });

  it("is enabled with no replay-bearing entries when the AI option is offered", () => {
    lobby.setLeaderboard([noReplayEntry]);
    expect(picker().disabled).toBe(false);
  });
});

describe("Lobby AI Record Pacer option", () => {
  const alice = entry({ timeMs: 22000, hasReplay: true });
  const carol = entry({
    name: "Carol",
    timeMs: 63000,
    date: "2026-01-03",
    hasReplay: true,
  });

  function aiOption(): HTMLOptionElement | undefined {
    return [...picker().options].find((o) => o.value === "ai");
  }

  it("offers the AI Record with the baked time when eligible", () => {
    buildReferenceLapMock.mockReturnValue(referenceLap(24680));
    mount();
    // The displayed time is the bake's, never a literal.
    expect(aiOption()!.textContent).toBe(`⚑ AI Record — ${formatMs(24680)}`);
  });

  it("is styled to match the Pacer cyan", () => {
    mount();
    expect(aiOption()!.classList.contains("pacer-opt-ai")).toBe(true);
  });

  it("sits at its time-sorted position among the human options", () => {
    // Alice 22.0s < AI 23.8s < Carol 63.0s
    mount().setLeaderboard([alice, carol]);
    expect(optionTexts()).toEqual([
      "No Pacer — race alone",
      `⚑ Alice — ${formatMs(22000)}`,
      `⚑ AI Record — ${formatMs(23800)}`,
      `⚑ Carol — ${formatMs(63000)}`,
    ]);
  });

  it("is absent on a Track without a trained policy", () => {
    mount();
    click(track("stormhaven"));
    expect(aiOption()).toBeUndefined();
  });

  it("is absent on a non-Medium Difficulty", () => {
    mount();
    for (const d of ["easy", "hard"]) {
      click(diff(d));
      expect(aiOption()).toBeUndefined();
    }
  });

  it("a null bake yields no AI option", () => {
    buildReferenceLapMock.mockReturnValue(null);
    mount();
    expect(aiOption()).toBeUndefined();
  });

  it('selecting it arms a kind:"ai" Pacer whose frames are the memoized bake', () => {
    mount();
    pickPacer("ai");
    expect(lobby.armedPacer).toEqual({
      kind: "ai",
      name: "AI Record",
      track: "sunset-ridge",
      difficulty: "medium",
      variant: "police",
      frames: AI_FRAMES,
    });
    // Same array, not a copy: the armed frames are the bake the time came from.
    expect((lobby.armedPacer as { frames: ReplayFrame[] }).frames).toBe(
      AI_FRAMES,
    );
  });

  it("selecting a human option replaces an armed AI, and vice versa", () => {
    mount().setLeaderboard([alice]);
    pickPacer("ai");
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
    pickPacer("0");
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", entry: alice });
    pickPacer("ai");
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
  });

  it.each([
    ["Track", track("stormhaven")],
    ["Difficulty", diff("hard")],
  ])(
    "switching %s to an ineligible context clears an armed AI Pacer",
    (_, selector) => {
      mount();
      pickPacer("ai");
      click(selector);
      expect(lobby.armedPacer).toBeNull();
      expect(picker().value).toBe("-1");
    },
  );

  it("an armed AI Pacer survives eligible re-renders (leaderboard refreshes)", () => {
    mount();
    pickPacer("ai");
    lobby.setLeaderboard([alice, carol]);
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
    expect(picker().value).toBe("ai");
  });

  it("bakes at most once across repeated renders", () => {
    mount();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    click(diff("hard"));
    click(diff("medium"));
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
  });

  it("does not bake again for ineligible renders", () => {
    mount();
    click(track("stormhaven"));
    buildReferenceLapMock.mockClear();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([]);
    expect(buildReferenceLapMock).not.toHaveBeenCalled();
  });

  it("a null bake is memoized too", () => {
    buildReferenceLapMock.mockReturnValue(null);
    mount();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
  });
});

describe("Lobby AI Record control", () => {
  beforeEach(mount);

  it("is visible for Sunset Ridge + Medium (default state)", () => {
    expect(q(".lb-ai-record").hidden).toBe(false);
  });

  it.each([
    ["Stormhaven is selected (no policy)", track("stormhaven")],
    ["Easy is selected for Sunset Ridge", diff("easy")],
    ["Hard is selected for Sunset Ridge", diff("hard")],
  ])("is hidden when %s", (_, selector) => {
    click(selector);
    expect(q(".lb-ai-record").hidden).toBe(true);
  });

  it("clicking the AI Record button invokes onReferenceLap", () => {
    click("button[data-ai-record]");
    expect(cbs.onReferenceLap).toHaveBeenCalledOnce();
  });

  it("onReferenceLap is not triggered by clicks on other leaderboard elements", () => {
    q(".lb-list").click();
    expect(cbs.onReferenceLap).not.toHaveBeenCalled();
  });
});

describe("Lobby Garage picker", () => {
  function selectCar(variant: string): void {
    for (let i = 0; i <= CAR_VARIANTS.length; i++) {
      if (active(card(variant))) return;
      click('[data-carousel="next"]');
    }
    throw new Error(`Could not select ${variant}`);
  }

  it("renders a card for each of the 8 Variants plus a Random tile", () => {
    mount();
    expect(parent.querySelectorAll(".garage-card").length).toBe(
      CAR_VARIANTS.length + 1,
    );
    for (const v of CAR_VARIANTS) expect(q(card(v))).not.toBeNull();
    expect(q(card("random"))).not.toBeNull();
  });

  it("car choices are on the garage screen and settings start inaccessible", () => {
    mount();
    expect(q(".garage-screen .garage")).not.toBeNull();
    expect(q(".settings-screen .diff-picker")).not.toBeNull();
    expect(q(".settings-screen").hasAttribute("inert")).toBe(true);
    expect(q(".settings-screen").getAttribute("aria-hidden")).toBe("true");
  });

  it("cards carry the Variant display name, with no separate selected-state line", () => {
    mount();
    expect(q(card("suv")).textContent).toContain("SUV");
    expect(q(card("random")).textContent).toContain("Random");
    expect(parent.querySelector(".garage-selected")).toBeNull();
  });

  it("pre-selects Random on first visit", () => {
    mount();
    expect(active(card("random"))).toBe(true);
    expect(parent.querySelectorAll(".garage-card.active").length).toBe(1);
  });

  it("clicking a garage card selects that model directly", () => {
    mount();
    click(card("police"));
    expect(active(card("police"))).toBe(true);
    expect(checked(card("police"))).toBe("true");
    expect(q(card("police")).tabIndex).toBe(0);
    expect(checked(card("random"))).toBe("false");
    expect(q(card("random")).tabIndex).toBe(-1);
    expect(lobby.selectedVariant).toBe("police");
    expect(localStorage.getItem("racer-variant")).toBe("police");
    expect(parent.querySelectorAll(".garage-card.active").length).toBe(1);
  });

  it("cycling to a model stores the choice and moves the highlight", () => {
    mount();
    selectCar("suv");
    expect(localStorage.getItem("racer-variant")).toBe("suv");
    expect(active(card("suv"))).toBe(true);
    expect(active(card("random"))).toBe(false);
    expect(lobby.selectedVariant).toBe("suv");
  });

  it("a stored concrete Variant renders as the selected card", () => {
    localStorage.setItem("racer-variant", "taxi");
    mount();
    expect(active(card("taxi"))).toBe(true);
    expect(lobby.selectedVariant).toBe("taxi");
  });

  it("a stored Random choice stays Random", () => {
    localStorage.setItem("racer-variant", "random");
    mount();
    expect(active(card("random"))).toBe(true);
    expect(localStorage.getItem("racer-variant")).toBe("random");
  });

  it("an invalid stored value falls back to Random and overwrites the stored value", () => {
    localStorage.setItem("racer-variant", "batmobile");
    mount();
    expect(active(card("random"))).toBe(true);
    expect(localStorage.getItem("racer-variant")).toBe("random");
  });

  it('Random resolves to a concrete member of CAR_VARIANTS, never the wire string "random"', () => {
    mount();
    expect(CAR_VARIANTS).toContain(lobby.selectedVariant);
  });

  it("Random keeps a single roll for the connection", () => {
    mount();
    const first = lobby.selectedVariant;
    selectCar("suv");
    selectCar("random");
    expect(lobby.selectedVariant).toBe(first);
  });

  it("a choice change triggers a hello re-send", () => {
    mount();
    click('[data-carousel="next"]');
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    click('[data-carousel="previous"]');
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(2);
  });

  it("clicking model indicators notifies once per change and ignores repeats", () => {
    mount();
    click(card("suv"));
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    click(card("suv"));
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    click(card("random"));
    expect(active(card("random"))).toBe(true);
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(2);
  });

  it("painting thumbnails without WebGL leaves the cards name-only", () => {
    mount();
    expect(() => lobby.paintGarageThumbnails()).not.toThrow();
    for (const img of parent.querySelectorAll(".garage-card img"))
      expect(img.getAttribute("src")).toBeNull();
  });

  it("cycles across every car and Random, wrapping in both directions", () => {
    mount();
    for (const variant of CAR_VARIANTS) {
      click('[data-carousel="next"]');
      expect(checked(card(variant))).toBe("true");
      expect(
        q('.car-slide[data-position="current"]').getAttribute("data-slide"),
      ).toBe(variant);
    }
    click('[data-carousel="next"]');
    expect(checked(card("random"))).toBe("true");
    click('[data-carousel="previous"]');
    expect(checked(card(CAR_VARIANTS.at(-1)!))).toBe("true");
  });

  it("requires car and track confirmation before entering settings", () => {
    mount();
    selectCar("police");
    const settings = q(".settings-screen");
    expect(settings.hasAttribute("inert")).toBe(true);
    click("[data-select-car]");
    expect(settings.hasAttribute("inert")).toBe(true);
    expect(q(".track-screen").hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(q("[data-select-track]"));
    click("[data-select-track]");
    expect(settings.hasAttribute("inert")).toBe(false);
    expect(settings.getAttribute("aria-hidden")).toBe("false");
    expect(q(".garage-screen").hasAttribute("inert")).toBe(true);
    expect(q(".track-screen").hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(q('[data-setup-tab="race"]'));
  });

  it("preserves setup values when changing the car", () => {
    mount();
    enterSettings();
    q<HTMLInputElement>("#driver-name").value = "Night Driver";
    q<HTMLInputElement>(".create-form input").value = "Final lap";
    click(track("stormhaven"));
    click(diff("hard"));
    click("[data-change-car]");
    expect(q(".settings-screen").hasAttribute("inert")).toBe(true);
    selectCar("van");
    enterSettings();
    expect(lobby.playerName).toBe("Night Driver");
    expect(q<HTMLInputElement>(".create-form input").value).toBe("Final lap");
    expect(checked(track("stormhaven"))).toBe("true");
    expect(checked(diff("hard"))).toBe("true");
  });

  it("supports arrow navigation from the car stage and does not intercept typing", () => {
    mount();
    const stage = q(".car-stage");
    stage.focus();
    press(stage, "ArrowRight");
    expect(document.activeElement).toBe(stage);
    expect(lobby.selectedVariant).toBe(CAR_VARIANTS[0]);
    expect(parent.querySelectorAll('.garage-card[tabindex="0"]')).toHaveLength(
      1,
    );
    enterSettings();
    press(q("#driver-name"), "ArrowRight");
    expect(lobby.selectedVariant).toBe(CAR_VARIANTS[0]);
  });

  it("dragging never changes the selected car", () => {
    mount();
    const stage = q(".car-stage");
    const drag = (from: [number, number], to: [number, number]) => {
      stage.dispatchEvent(
        new MouseEvent("pointerdown", { clientX: from[0], clientY: from[1] }),
      );
      stage.dispatchEvent(
        new MouseEvent("pointerup", { clientX: to[0], clientY: to[1] }),
      );
    };
    drag([220, 120], [90, 130]);
    expect(checked(card("random"))).toBe("true");
    drag([220, 120], [190, 280]);
    expect(checked(card("random"))).toBe("true");
    expect(cbs.onVariantChange).not.toHaveBeenCalled();
  });

  it("cycles full track previews and preserves the circuit when returning from settings", () => {
    mount();
    click("[data-select-car]");
    click('[data-track-carousel="next"]');
    expect(q(".track-slide.active").getAttribute("data-track-slide")).toBe(
      "stormhaven",
    );
    expect(q(".hero-track-name").textContent).toBe("Stormhaven Circuit");
    click("[data-select-track]");
    click("[data-change-track]");
    expect(q(".lobby-deck").getAttribute("data-screen")).toBe("track");
    expect(q(".track-card.active").getAttribute("data-track")).toBe(
      "stormhaven",
    );
    click('[data-track-carousel="next"]');
    expect(q(".track-slide.active").getAttribute("data-track-slide")).toBe(
      "sunset-ridge",
    );
  });

  it("switches setup panels without losing the race form or pacer", () => {
    mount();
    enterSettings();
    q<HTMLInputElement>(".create-form input").value = "Last light";
    pickPacer("ai");
    click('[data-setup-tab="records"]');
    expect(q('[data-setup-panel="race"]').hidden).toBe(true);
    expect(q('[data-setup-panel="records"]').hidden).toBe(false);
    click('[data-setup-tab="race"]');
    expect(q<HTMLInputElement>(".create-form input").value).toBe("Last light");
    expect(lobby.armedPacer?.kind).toBe("ai");
    expect(
      parent.querySelectorAll('[data-setup-tab][tabindex="0"]'),
    ).toHaveLength(1);
  });
});

describe("Lobby difficulty keyboard navigation", () => {
  it("uses one tab stop, wraps radios and clears an incompatible pacer", () => {
    mount();
    enterSettings();
    pickPacer("ai");
    const medium = q(diff("medium"));
    medium.focus();
    expect(parent.querySelectorAll('.diff-opt[tabindex="0"]')).toHaveLength(1);
    press(medium, "ArrowRight");
    const hard = q(diff("hard"));
    expect(document.activeElement).toBe(hard);
    expect(checked(diff("hard"))).toBe("true");
    expect(medium.tabIndex).toBe(-1);
    expect(lobby.armedPacer).toBeNull();
    press(hard, "ArrowDown");
    expect(document.activeElement).toBe(q(diff("easy")));
    expect(parent.querySelectorAll('.diff-opt[tabindex="0"]')).toHaveLength(1);
  });
});

describe("Lobby Records board filters", () => {
  const sunsetMedium = entry({ hasReplay: true });
  const sunsetHard = entry({
    name: "Bob",
    timeMs: 55000,
    date: "2026-01-02",
    difficulty: "hard",
  });
  const stormMedium = entry({
    name: "Carol",
    timeMs: 65000,
    date: "2026-01-03",
    hasReplay: true,
    track: "stormhaven",
  });

  beforeEach(() => {
    mount().setLeaderboard([sunsetMedium, sunsetHard, stormMedium]);
  });

  function boardTrackValue(): string | undefined {
    return q('.board-track-opt[aria-selected="true"]').dataset.boardTrack;
  }
  function note(): HTMLElement {
    return q(".board-note");
  }

  it("board filters default to the race selection and follow it", () => {
    expect(checked(boardDiff("medium"))).toBe("true");
    expect(boardTrackValue()).toBe("sunset-ridge");
    expect(note().hidden).toBe(true);
    click(diff("hard"));
    click(track("stormhaven"));
    expect(checked(boardDiff("hard"))).toBe("true");
    expect(boardTrackValue()).toBe("stormhaven");
    expect(note().hidden).toBe(true);
  });

  it("changing board difficulty re-filters the list without touching the race", () => {
    expect(names()).toEqual(["Alice"]);
    click(boardDiff("hard"));
    expect(names()).toEqual(["Bob"]);
    // Differing on difficulty alone is enough to show the browsing note.
    expect(note().hidden).toBe(false);
    expect(active(boardDiff("hard"))).toBe(true);
    expect(checked(boardDiff("medium"))).toBe("false");
    expect(active(diff("medium"))).toBe(true);
    expect(checked(diff("hard"))).toBe("false");
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "sunset-ridge",
      "medium",
    );
  });

  it("changing board track re-filters the list and keeps the pacer on the race", () => {
    pickPacer("0");
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Alice" });
    click('[data-board-track="stormhaven"]');
    expect(names()).toEqual(["Carol"]);
    // Differing on track alone is enough to show the browsing note.
    expect(note().hidden).toBe(false);
    // Pacer choices and the armed pacer still belong to the race setup.
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Alice" });
    const texts = optionTexts().join("\n");
    expect(texts).toContain("Alice");
    expect(texts).not.toContain("Carol");
    expect(q(".selected-track-name").textContent).toContain("Sunset Ridge");
  });

  it("replay buttons carry the browsed entry's track and difficulty", () => {
    click('[data-board-track="stormhaven"]');
    click(".lb-replay");
    expect(cbs.onReplay).toHaveBeenCalledWith("Carol", "stormhaven", "medium");
  });

  it("shows the browsing note when filters differ; Use these settings syncs the race", () => {
    click(boardDiff("hard"));
    click('[data-board-track="stormhaven"]');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain(
      "Browsing only. Your race is still Sunset Ridge Circuit, Medium.",
    );
    q(".board-use-settings").focus();
    click(".board-use-settings");
    expect(note().hidden).toBe(true);
    // Focus moves off the now-hidden note rather than dropping to <body>.
    expect(document.activeElement).toBe(q(boardDiff("hard")));
    expect(active(diff("hard"))).toBe(true);
    expect(checked(track("stormhaven"))).toBe("true");
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "stormhaven",
      "hard",
    );
  });

  it("the empty state names the browsed track and difficulty", () => {
    click(boardDiff("easy"));
    click('[data-board-track="stormhaven"]');
    const empty = q(".lb-empty");
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector(".empty-timer")).not.toBeNull();
    expect(empty.textContent).toContain(
      "No laps yet on Stormhaven Circuit, Easy.",
    );
  });

  it("the AI Record button follows the board, not the race", () => {
    const ai = q(".lb-ai-record");
    expect(ai.hidden).toBe(false);
    click(boardDiff("hard"));
    expect(ai.hidden).toBe(true);
    click(boardDiff("medium"));
    click(diff("hard")); // syncs board to hard too
    expect(ai.hidden).toBe(true);
    click(boardDiff("medium"));
    expect(ai.hidden).toBe(false);
  });

  it("supports roving tabindex and arrow/Home/End keys on the board radiogroup", () => {
    enterSettings();
    expect(
      parent.querySelectorAll('.board-diff-opt[tabindex="0"]'),
    ).toHaveLength(1);
    q(boardDiff("medium")).focus();
    press(q(boardDiff("medium")), "ArrowRight");
    expect(document.activeElement).toBe(q(boardDiff("hard")));
    expect(checked(boardDiff("hard"))).toBe("true");
    expect(q(boardDiff("medium")).tabIndex).toBe(-1);
    expect(names()).toEqual(["Bob"]);
    press(q(boardDiff("hard")), "ArrowRight"); // wraps
    expect(document.activeElement).toBe(q(boardDiff("easy")));
    press(q(boardDiff("easy")), "ArrowLeft"); // wraps back
    expect(document.activeElement).toBe(q(boardDiff("hard")));
    press(q(boardDiff("hard")), "Home");
    expect(document.activeElement).toBe(q(boardDiff("easy")));
    press(q(boardDiff("easy")), "End");
    expect(document.activeElement).toBe(q(boardDiff("hard")));
    // The race difficulty never moved.
    expect(checked(diff("medium"))).toBe("true");
    expect(parent.querySelectorAll('.diff-opt[tabindex="0"]')).toHaveLength(1);
  });
});

function installDesktop(bridge: object): void {
  Object.defineProperty(window, "desktop", {
    value: { serverUrl: "wss://play.example.com", ...bridge },
    configurable: true,
  });
}

describe("Lobby desktop download notice", () => {
  it("links to the GitHub releases page in the browser build", () => {
    mount();
    const link = q<HTMLAnchorElement>(".lobby-nav .desktop-notice");
    expect(link).not.toBeNull();
    expect(link.href).toBe(DESKTOP_DOWNLOAD_URL);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent).toContain("Download for macOS, Windows & Linux");
    expect(link.getAttribute("aria-label")).toMatch(/macOS, Windows and Linux/);
  });

  it("is absent inside the desktop app (window.desktop defined)", () => {
    installDesktop({});
    mount();
    expect(parent.querySelector(".desktop-notice")).toBeNull();
    expect(q(".connection-status")).not.toBeNull();
  });
});

describe("Lobby desktop update notice", () => {
  let onStateCb: ((state: DesktopUpdateState) => void) | undefined;
  let updates: DesktopUpdates;

  function installBridge(
    initial: DesktopUpdateState = { status: "idle" },
  ): void {
    onStateCb = undefined;
    updates = {
      getState: vi.fn(async () => initial),
      install: vi.fn(async () => {}),
      check: vi.fn(async () => {}),
      onState: vi.fn((cb: (state: DesktopUpdateState) => void) => {
        onStateCb = cb;
        return () => {
          onStateCb = undefined;
        };
      }),
    };
    installDesktop({ version: "0.1.0", updates });
    mount();
  }
  const button = () =>
    parent.querySelector<HTMLButtonElement>(".lobby-nav-aside .update-notice");

  it("is absent in the browser build", () => {
    mount();
    expect(button()).toBeNull();
  });

  it("is absent when the desktop preload predates updates", () => {
    installDesktop({});
    mount();
    expect(button()).toBeNull();
  });

  it("is visible with the installed version while the updater is idle", async () => {
    installBridge();
    await Promise.resolve();
    expect(button()).not.toBeNull();
    expect(button()!.hidden).toBe(false);
    expect(button()!.disabled).toBe(false);
    expect(button()!.textContent).toContain("v0.1.0 · Up to date");
    expect(button()!.dataset.status).toBe("idle");
    expect(button()!.getAttribute("aria-live")).toBe("polite");
    expect(updates.onState).toHaveBeenCalledTimes(1);
    expect(updates.getState).toHaveBeenCalledTimes(1);
    expect(button()!.compareDocumentPosition(q(".connection-status"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("catches up from getState when the check already finished", async () => {
    installBridge({ status: "downloaded", version: "0.2.0" });
    await Promise.resolve();
    expect(button()!.textContent).toContain("Restart to update");
    expect(button()!.dataset.status).toBe("downloaded");
  });

  it.each<[DesktopUpdateState, string, boolean]>([
    [{ status: "checking" }, "Checking for updates…", true],
    [
      { status: "available", version: "0.2.0", canInstall: true },
      "Update to v0.2.0",
      false,
    ],
    [
      { status: "available", version: "0.2.0", canInstall: false },
      "Download v0.2.0",
      false,
    ],
    [
      { status: "downloading", version: "0.2.0", percent: 42 },
      "Updating… 42%",
      true,
    ],
    [
      { status: "error", message: "offline" },
      "Update check failed · Retry",
      false,
    ],
  ])("reports %o as '%s'", (state, text, busy) => {
    installBridge();
    onStateCb!(state);
    expect(button()!.hidden).toBe(false);
    expect(button()!.disabled).toBe(busy);
    expect(button()!.textContent).toContain(text);
    expect(button()!.getAttribute("aria-label")).toBe(text);
    expect(button()!.dataset.status).toBe(state.status);
  });

  it("triggers a manual check when clicked while idle", () => {
    installBridge();
    button()!.click();
    expect(updates.check).toHaveBeenCalledTimes(1);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it("calls install when clicked with an update available", () => {
    installBridge();
    onStateCb!({ status: "available", version: "0.2.0", canInstall: true });
    button()!.click();
    expect(updates.install).toHaveBeenCalledTimes(1);
    expect(updates.check).not.toHaveBeenCalled();
  });

  it("re-checks when clicked after an error", () => {
    installBridge();
    onStateCb!({ status: "error", message: "offline" });
    button()!.click();
    expect(updates.check).toHaveBeenCalledTimes(1);
  });
});
