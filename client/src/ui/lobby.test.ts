// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DESKTOP_DOWNLOAD_URL, Lobby, type LobbyCallbacks } from "./lobby";
import {
  CAR_VARIANTS,
  medalTimes,
  type DailyBoard,
  type DailyEntry,
  type Difficulty,
  type LeaderboardEntry,
  type ReplayFrame,
  type Standing,
  type TrackSlug,
  TRACKS,
} from "@racing/shared";
import { shareText } from "./daily-banner";
import type { ReferenceLap } from "../game/reference-lap";
import { JEV_LAP } from "../game/jev-lap";
import { SoundSettings } from "../game/sound-settings";
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
// Thumbnails need WebGL; capture the lobby's image callback so tests deliver them.
const { thumbnails } = vi.hoisted(() => ({
  thumbnails: { deliver: (_variant: string, _url: string): void => {} },
}));
vi.mock("./garage-thumbs", () => ({
  renderVariantThumbnails: (_variants: unknown, onImage: typeof thumbnails.deliver) => {
    thumbnails.deliver = onImage;
  },
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

function standing(overrides: Partial<Standing> = {}): Standing {
  return { track: "sunset-ridge", difficulty: "medium", bestMs: null, rival: null, ...overrides };
}
/** A board's Medal target times; every registered board has them. */
function targets(track: TrackSlug = "sunset-ridge", difficulty: Difficulty = "medium") {
  return medalTimes(track, difficulty)!;
}

let parent: HTMLElement;
let lobby: Lobby;
let cbs: LobbyCallbacks;
let sound: SoundSettings;

/** Mounts a fresh Lobby into `parent`; call again in a test to remount. */
function mount(): Lobby {
  cbs = {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onReplay: vi.fn(),
    onReferenceLap: vi.fn(),
    onJevLap: vi.fn(),
    onDaily: vi.fn(),
    onVariantChange: vi.fn(),
    onNameChange: vi.fn(),
  };
  sound = new SoundSettings();
  lobby = new Lobby(parent, cbs, sound);
  return lobby;
}
function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  return parent.querySelector<T>(selector)!;
}
function click(selector: string): void {
  q<HTMLButtonElement>(selector).click();
}
function press(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
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
  return [...picker().options].map((o) => o.textContent);
}
function names(): string[] {
  return [...parent.querySelectorAll(".lb-list .lb-name")].map((n) => n.textContent);
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
/** Mounts a Lobby already on Race Setup, where the Pacer picker is painted. */
function mountSetup(): Lobby {
  mount();
  enterSettings();
  return lobby;
}
const track = (slug: string) => `button[data-track="${slug}"]`;
const diff = (d: string) => `button[data-diff="${d}"]`;
const boardDiff = (d: string) => `.board-diff-opt[data-board-diff="${d}"]`;
const steering = (mode: string) => `.steering-opt[data-steering="${mode}"]`;
const card = (variant: string) => `.garage-card[data-variant="${variant}"]`;
/** Where first-time visitors start: Hatch S, the first Variant free without a Medal. */
const FREE = "hatchback-sports";

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
    expect(q(track("sunset-ridge")).textContent).toContain("Sunset Ridge Circuit");
    expect(q(track("stormhaven")).textContent).toContain("Stormhaven Circuit");
  });

  it("selecting Stormhaven filters the leaderboard to Stormhaven entries", () => {
    lobby.setLeaderboard([entry(), entry({ name: "Bob", timeMs: 65000, track: "stormhaven" })]);
    click(track("stormhaven"));
    expect(names()).toEqual(["Bob"]);
  });
});

describe("Lobby unified difficulty selector", () => {
  beforeEach(mount);

  it("has a unified difficulty button for each difficulty", () => {
    for (const d of ["easy", "medium", "hard"]) expect(q(diff(d))).not.toBeNull();
  });

  it("the Records board has its own difficulty radios that never carry data-diff", () => {
    const boardRadios = parent.querySelectorAll("button[data-board-diff]");
    expect(boardRadios).toHaveLength(3);
    boardRadios.forEach((b) => expect(b.hasAttribute("data-diff")).toBe(false));
  });

  it("clicking hard filters the leaderboard to hard entries", () => {
    lobby.setLeaderboard([entry(), entry({ name: "Bob", timeMs: 55000, difficulty: "hard" })]);
    click(diff("hard"));
    expect(names()).toEqual(["Bob"]);
  });
});

describe("Lobby create-room callback", () => {
  beforeEach(mount);

  it("submitting the form calls onCreate with default track (sunset-ridge) and difficulty (medium)", () => {
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), "sunset-ridge", "medium");
  });

  it("onCreate includes selected track after switching to Stormhaven", () => {
    click(track("stormhaven"));
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), "stormhaven", "medium");
  });

  it("onCreate includes selected difficulty after switching to hard", () => {
    click(diff("hard"));
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), "sunset-ridge", "hard");
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
      },
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
    mountSetup().setLeaderboard([replayEntry, noReplayEntry, replayEntry2]);
  });

  /** Selects the option naming `name` (or "No Pacer" when null) and fires change. */
  function pickByName(name: string | null): void {
    pickPacer(
      name === null ? "-1" : [...picker().options].find((o) => o.textContent.includes(name))!.value,
    );
  }

  it("picker lives in the Starting Grid panel", () => {
    expect(q(".panel-rooms .pacer-select")).not.toBeNull();
  });

  it("non-replay row shows no Watch button", () => {
    const bobRow = [...parent.querySelectorAll(".lb-list li")].find((li) =>
      li.textContent.includes("Bob"),
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
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Carol" });
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
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Alice" });
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
    mountSetup();
    // The displayed time is the bake's, never a literal.
    expect(aiOption()!.textContent).toBe(`⚑ AI Record — ${formatMs(24680)}`);
  });

  it("is styled to match the Pacer cyan", () => {
    mountSetup();
    expect(aiOption()!.classList.contains("pacer-opt-ai")).toBe(true);
  });

  it("sits at its time-sorted position among the human options", () => {
    // Alice 22.0s < AI 23.8s < Carol 63.0s
    mountSetup().setLeaderboard([alice, carol]);
    expect(optionTexts()).toEqual([
      "No Pacer — race alone",
      `⚑ Alice — ${formatMs(22000)}`,
      `⚑ AI Record — ${formatMs(23800)}`,
      `⚑ Carol — ${formatMs(63000)}`,
    ]);
  });

  it("is absent on a Track without a trained policy", () => {
    mountSetup();
    click(track("stormhaven"));
    expect(aiOption()).toBeUndefined();
  });

  it("is absent on a non-Medium Difficulty", () => {
    mountSetup();
    for (const d of ["easy", "hard"]) {
      click(diff(d));
      expect(aiOption()).toBeUndefined();
    }
  });

  it("a null bake yields no AI option", () => {
    buildReferenceLapMock.mockReturnValue(null);
    mountSetup();
    expect(aiOption()).toBeUndefined();
  });

  it('selecting it arms a kind:"ai" Pacer whose frames are the memoized bake', () => {
    mountSetup();
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
    expect((lobby.armedPacer as { frames: ReplayFrame[] }).frames).toBe(AI_FRAMES);
  });

  it("selecting a human option replaces an armed AI, and vice versa", () => {
    mountSetup().setLeaderboard([alice]);
    pickPacer("ai");
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
    pickPacer("0");
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Alice" });
    pickPacer("ai");
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
  });

  it.each([
    ["Track", track("stormhaven")],
    ["Difficulty", diff("hard")],
  ])("switching %s to an ineligible context clears an armed AI Pacer", (_, selector) => {
    mountSetup();
    pickPacer("ai");
    click(selector);
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
  });

  it("an armed AI Pacer survives eligible re-renders (leaderboard refreshes)", () => {
    mountSetup();
    pickPacer("ai");
    lobby.setLeaderboard([alice, carol]);
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
    expect(picker().value).toBe("ai");
  });

  it("bakes at most once across repeated renders", () => {
    mountSetup();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    click(diff("hard"));
    click(diff("medium"));
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
  });

  it("does not bake again for ineligible renders", () => {
    mountSetup();
    click(track("stormhaven"));
    buildReferenceLapMock.mockClear();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([]);
    expect(buildReferenceLapMock).not.toHaveBeenCalled();
  });

  it("waits for Race Setup before baking", () => {
    mount();
    lobby.setLeaderboard([alice]);
    expect(buildReferenceLapMock).not.toHaveBeenCalled();
    enterSettings();
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
    expect(aiOption()).toBeDefined();
  });

  it("a null bake is memoized too", () => {
    buildReferenceLapMock.mockReturnValue(null);
    mountSetup();
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

describe("Lobby Jev controls", () => {
  beforeEach(mount);

  it("shows Watch Jev Lap alongside the AI Record and routes its click", () => {
    expect(q(".lb-jev-lap-btn").closest<HTMLElement>(".lb-ai-record")!.hidden).toBe(false);
    click("button[data-jev-lap]");
    expect(cbs.onJevLap).toHaveBeenCalledOnce();
    expect(cbs.onReferenceLap).not.toHaveBeenCalled();
  });

  it("labels Watch Jev Lap with the bundled lap's time", () => {
    expect(q(".lb-jev-lap-btn").textContent).toBe(`▶ Watch Jev Lap · ${formatMs(JEV_LAP!.timeMs)}`);
    expect(q(".lb-jev-lap-btn").textContent).toMatch(/^▶ Watch Jev Lap · \d:\d\d\.\d{3}$/);
  });

  it.each([
    ["Stormhaven", '[data-board-track="stormhaven"]'],
    ["Hard", boardDiff("hard")],
  ])("hides Watch Jev Lap with the AI Record while the Records board browses %s", (_, filter) => {
    click(filter);
    expect(q(".lb-jev-lap-btn").closest<HTMLElement>(".lb-ai-record")!.hidden).toBe(true);
    click('[data-board-track="sunset-ridge"]');
    click(boardDiff("medium"));
    expect(q(".lb-jev-lap-btn").closest<HTMLElement>(".lb-ai-record")!.hidden).toBe(false);
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

  it("renders a card for each of the 8 Variants and no Random tile", () => {
    mount();
    expect(parent.querySelectorAll(".garage-card").length).toBe(CAR_VARIANTS.length);
    for (const v of CAR_VARIANTS) expect(q(card(v))).not.toBeNull();
    expect(parent.querySelector(card("random"))).toBeNull();
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
    expect(parent.querySelector(".garage-selected")).toBeNull();
  });

  it("pre-selects the first free car on first visit", () => {
    mount();
    expect(active(card(FREE))).toBe(true);
    expect(lobby.selectedVariant).toBe(FREE);
    expect(parent.querySelectorAll(".garage-card.active").length).toBe(1);
  });

  it("clicking a garage card selects that model directly", () => {
    mount();
    click(card("taxi"));
    expect(active(card("taxi"))).toBe(true);
    expect(checked(card("taxi"))).toBe("true");
    expect(q(card("taxi")).tabIndex).toBe(0);
    expect(checked(card(FREE))).toBe("false");
    expect(q(card(FREE)).tabIndex).toBe(-1);
    expect(lobby.selectedVariant).toBe("taxi");
    expect(localStorage.getItem("racer-variant")).toBe("taxi");
    expect(parent.querySelectorAll(".garage-card.active").length).toBe(1);
  });

  it("cycling to a model stores the choice and moves the highlight", () => {
    mount();
    selectCar("suv");
    expect(localStorage.getItem("racer-variant")).toBe("suv");
    expect(active(card("suv"))).toBe(true);
    expect(active(card(FREE))).toBe(false);
    expect(lobby.selectedVariant).toBe("suv");
  });

  it("a stored concrete Variant renders as the selected card", () => {
    localStorage.setItem("racer-variant", "taxi");
    mount();
    expect(active(card("taxi"))).toBe(true);
    expect(lobby.selectedVariant).toBe("taxi");
  });

  it.each(["random", "batmobile"])(
    "a stored %s falls back to the first free car and overwrites the stored value",
    (stored) => {
      localStorage.setItem("racer-variant", stored);
      mount();
      expect(active(card(FREE))).toBe(true);
      expect(lobby.selectedVariant).toBe(FREE);
      expect(localStorage.getItem("racer-variant")).toBe(FREE);
    },
  );

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
    click(card("taxi"));
    expect(active(card("taxi"))).toBe(true);
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(2);
  });

  it("painting thumbnails without WebGL leaves the cards name-only", () => {
    mount();
    expect(() => lobby.paintGarageThumbnails()).not.toThrow();
    for (const img of parent.querySelectorAll(".garage-card img"))
      expect(img.getAttribute("src")).toBeNull();
  });

  it("hides the Race Setup car image until the selected car's thumbnail is ready", () => {
    mount();
    lobby.paintGarageThumbnails();
    selectCar("taxi");
    thumbnails.deliver("taxi", "blob:taxi");
    expect(q<HTMLImageElement>(".setup-car-image").src).toBe("blob:taxi");
    selectCar("van");
    for (const selector of [".setup-car-image", ".selected-car-thumb"])
      expect(q<HTMLImageElement>(selector).hidden).toBe(true);
    thumbnails.deliver("van", "blob:van");
    expect(q<HTMLImageElement>(".setup-car-image").src).toBe("blob:van");
    expect(q<HTMLImageElement>(".setup-car-image").hidden).toBe(false);
  });

  it("cycles across every car, locked ones included, wrapping in both directions", () => {
    mount();
    const start = CAR_VARIANTS.indexOf(FREE);
    for (let i = 1; i <= CAR_VARIANTS.length; i++) {
      const variant = CAR_VARIANTS[(start + i) % CAR_VARIANTS.length];
      click('[data-carousel="next"]');
      expect(checked(card(variant))).toBe("true");
      expect(q('.car-slide[data-position="current"]').getAttribute("data-slide")).toBe(variant);
    }
    click('[data-carousel="previous"]');
    expect(checked(card(CAR_VARIANTS[start - 1]))).toBe("true");
  });

  it("requires car and track confirmation before entering settings", () => {
    mount();
    selectCar("van");
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
    expect(lobby.selectedVariant).toBe("suv");
    expect(parent.querySelectorAll('.garage-card[tabindex="0"]')).toHaveLength(1);
    enterSettings();
    press(q("#driver-name"), "ArrowRight");
    expect(lobby.selectedVariant).toBe("suv");
  });

  it("dragging never changes the selected car", () => {
    mount();
    const stage = q(".car-stage");
    const drag = (from: [number, number], to: [number, number]) => {
      stage.dispatchEvent(new MouseEvent("pointerdown", { clientX: from[0], clientY: from[1] }));
      stage.dispatchEvent(new MouseEvent("pointerup", { clientX: to[0], clientY: to[1] }));
    };
    drag([220, 120], [90, 130]);
    expect(checked(card(FREE))).toBe("true");
    drag([220, 120], [190, 280]);
    expect(checked(card(FREE))).toBe("true");
    expect(cbs.onVariantChange).not.toHaveBeenCalled();
  });

  it("cycles full track previews and preserves the circuit when returning from settings", () => {
    mount();
    click("[data-select-car]");
    click('[data-track-carousel="next"]');
    expect(q(".track-slide.active").getAttribute("data-track-slide")).toBe("stormhaven");
    expect(q(".hero-track-name").textContent).toBe("Stormhaven Circuit");
    click("[data-select-track]");
    click("[data-change-track]");
    expect(q(".lobby-deck").getAttribute("data-screen")).toBe("track");
    expect(q(".track-card.active").getAttribute("data-track")).toBe("stormhaven");
    // Stepping on past the last track wraps round to the first.
    for (let index = 1; index < TRACKS.length; index++) click('[data-track-carousel="next"]');
    expect(q(".track-slide.active").getAttribute("data-track-slide")).toBe("sunset-ridge");
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
    expect(parent.querySelectorAll('[data-setup-tab][tabindex="0"]')).toHaveLength(1);
  });
});

describe("Lobby Daily Challenge banner", () => {
  const challenge: DailyBoard["challenge"] = {
    number: 142,
    date: "2027-02-22",
    track: "stormhaven",
    difficulty: "hard",
    variant: "race-future",
    scene: "golden-hour",
  };
  const board = (...entries: [string, number][]): DailyBoard => ({
    challenge,
    entries: entries.map(([name, timeMs]): DailyEntry => ({ name, timeMs })),
  });
  const banner = () => q(".garage-screen .daily");
  const text = (selector: string) =>
    [...banner().querySelectorAll(selector)].map((n) => n.textContent);
  const share = () => q<HTMLButtonElement>(".daily-share");
  function typeName(name: string): void {
    const input = q<HTMLInputElement>("#driver-name");
    input.value = name;
    input.dispatchEvent(new Event("input"));
  }

  beforeEach(mount);
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("stays hidden while the server has sent no board", () => {
    expect(banner().hidden).toBe(true);
    lobby.setDaily(board());
    expect(banner().hidden).toBe(false);
    lobby.setDaily(undefined);
    expect(banner().hidden).toBe(true);
  });

  it("shows today's challenge and the three fastest times on the Garage screen", () => {
    lobby.setDaily(board(["<b>Ana</b>", 61000], ["Ben", 62310], ["Cy", 63000], ["Dee", 64000]));
    expect(text(".daily-number")).toEqual(["DAILY #142"]);
    expect(text(".daily-track")).toEqual(["Stormhaven Circuit"]);
    expect(text(".daily-specs dd")).toEqual(["Hard", "Hyper", "Golden hour"]);
    expect(text(".daily-name")).toEqual(["<b>Ana</b>", "Ben", "Cy"]);
    expect(text(".daily-time")).toEqual([formatMs(61000), formatMs(62310), formatMs(63000)]);
  });

  it("shows the standing of the driver name as it is typed", () => {
    lobby.setDaily(board(["Ana", 61000], ["Ben", 62310], ["Cy", 63000]));
    typeName("Ben");
    expect(text(".daily-standing span")).toEqual(["Ben", "P2 of 3 · 1:02.310"]);
    expect(text(".daily-top .mine .daily-name")).toEqual(["Ben"]);
    typeName("Cy");
    expect(text(".daily-result")).toEqual(["P3 of 3 · 1:03.000"]);
    typeName("Zed");
    expect(text(".daily-result")).toEqual(["No time yet today"]);
    expect(text(".daily-top .mine")).toEqual([]);
  });

  it("Race the Daily joins straight from the Garage and keeps the driver name", () => {
    lobby.setDaily(board());
    click(".daily-race");
    expect(cbs.onDaily).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("racer-name")).toBe(lobby.playerName);
  });

  it("Share waits for the driver's time today, then copies their share line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    typeName("Ben");
    lobby.setDaily(board(["Ana", 61000]));
    expect(share().disabled).toBe(true);
    lobby.setDaily(board(["Ana", 61000], ["Ben", 62319]));
    expect(share().disabled).toBe(false);
    share().click();
    await vi.waitFor(() => expect(share().textContent).toBe("Copied ✓"));
    expect(writeText).toHaveBeenCalledWith(shareText(challenge, 62319));
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

describe("Lobby steering preference", () => {
  it("is a Steering radio group on Race Setup that defaults to the slider", () => {
    mountSetup();
    const group = q(".settings-screen .steering-picker");
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(group.getAttribute("aria-label")).toBe("Steering");
    expect(q(steering("slider")).textContent).toBe("Slider");
    expect(q(steering("buttons")).textContent).toBe("Buttons");
    expect(checked(steering("slider"))).toBe("true");
    expect(checked(steering("buttons"))).toBe("false");
    expect(lobby.steering).toBe("slider");
    expect(localStorage.getItem("racer-steering")).toBeNull();
  });

  it("choosing Buttons persists across a remount", () => {
    mountSetup();
    click(steering("buttons"));
    expect(checked(steering("buttons"))).toBe("true");
    expect(checked(steering("slider"))).toBe("false");
    expect(lobby.steering).toBe("buttons");
    expect(localStorage.getItem("racer-steering")).toBe("buttons");
    parent.replaceChildren();
    mount();
    expect(lobby.steering).toBe("buttons");
    expect(checked(steering("buttons"))).toBe("true");
  });

  it("falls back to the slider for an unknown saved value", () => {
    localStorage.setItem("racer-steering", "joystick");
    mount();
    expect(lobby.steering).toBe("slider");
    expect(checked(steering("slider"))).toBe("true");
  });

  it("moves with the arrow keys as one tab stop", () => {
    mountSetup();
    const slider = q(steering("slider"));
    slider.focus();
    expect(parent.querySelectorAll('.steering-opt[tabindex="0"]')).toHaveLength(1);
    press(slider, "ArrowRight");
    expect(document.activeElement).toBe(q(steering("buttons")));
    expect(lobby.steering).toBe("buttons");
    expect(localStorage.getItem("racer-steering")).toBe("buttons");
    press(q(steering("buttons")), "ArrowRight");
    expect(lobby.steering).toBe("slider");
    expect(parent.querySelectorAll('.steering-opt[tabindex="0"]')).toHaveLength(1);
  });
});

describe("Lobby sound settings", () => {
  const volume = () => q<HTMLInputElement>(".sound-volume");
  const mute = () => q(".sound-mute");

  it("is a Sound group on Race Setup showing the stored volume and mute", () => {
    localStorage.setItem("racer-volume", "40");
    localStorage.setItem("racer-muted", "true");
    mountSetup();
    const group = q(".settings-screen .sound-field");
    expect(group.getAttribute("role")).toBe("group");
    expect(q(`#${group.getAttribute("aria-labelledby")}`).textContent).toBe("Sound");
    expect(volume().getAttribute("aria-label")).toBe("Volume");
    expect(volume().value).toBe("40");
    expect(q(".sound-volume-value").textContent).toBe("40%");
    expect(mute().textContent).toBe("Mute");
    expect(mute().getAttribute("aria-pressed")).toBe("true");
  });

  it("saves a new volume and a press of Mute", () => {
    mountSetup();
    expect(volume().value).toBe("70");
    expect(mute().getAttribute("aria-pressed")).toBe("false");
    volume().value = "25";
    volume().dispatchEvent(new Event("input", { bubbles: true }));
    click(".sound-mute");
    expect(sound.volume).toBe(25);
    expect(sound.muted).toBe(true);
    expect(localStorage.getItem("racer-volume")).toBe("25");
    expect(localStorage.getItem("racer-muted")).toBe("true");
    expect(q(".sound-volume-value").textContent).toBe("25%");
    expect(mute().getAttribute("aria-pressed")).toBe("true");
  });

  it("follows a change made in the race", () => {
    mountSetup();
    sound.toggleMuted();
    sound.setVolume(90);
    expect(mute().getAttribute("aria-pressed")).toBe("true");
    expect(volume().value).toBe("90");
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
    mountSetup().setLeaderboard([sunsetMedium, sunsetHard, stormMedium]);
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
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), "sunset-ridge", "medium");
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
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), "stormhaven", "hard");
  });

  it("the empty state names the browsed track and difficulty", () => {
    click(boardDiff("easy"));
    click('[data-board-track="stormhaven"]');
    const empty = q(".lb-empty");
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector(".empty-timer")).not.toBeNull();
    expect(empty.textContent).toContain("No laps yet on Stormhaven Circuit, Easy.");
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
    expect(parent.querySelectorAll('.board-diff-opt[tabindex="0"]')).toHaveLength(1);
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

describe("Lobby Race Setup medals", () => {
  const times = targets();
  /** Each Medal target's state in `scope`, easiest first. */
  function states(scope = ".medal-field"): string[] {
    return [...parent.querySelectorAll<HTMLElement>(`${scope} .medal-target`)].map(
      (t) => `${t.dataset.medal}:${t.dataset.state}`,
    );
  }

  it.each([
    [
      "no lap",
      null,
      "No lap yet",
      ["bronze:next", "silver:unearned", "gold:unearned", "author:unearned"],
    ],
    [
      "a lap slower than Bronze",
      times.bronze + 1,
      "No medal yet",
      ["bronze:next", "silver:unearned", "gold:unearned", "author:unearned"],
    ],
    [
      "a Silver lap",
      times.silver - 1,
      "Silver medal",
      ["bronze:earned", "silver:earned", "gold:next", "author:unearned"],
    ],
    [
      "an Author lap",
      times.author,
      "Author medal",
      ["bronze:earned", "silver:earned", "gold:earned", "author:earned"],
    ],
  ])("with %s, shows the best, its Medal and lights the targets", (_, bestMs, medal, lit) => {
    mountSetup().setStandings([standing({ bestMs })]);
    const best = q(".medal-best").textContent;
    if (bestMs !== null) expect(best).toContain(formatMs(bestMs));
    expect(best).toContain(medal);
    expect(states()).toEqual(lit);
    expect(q(".medal-field .medal-targets").textContent).toContain(formatMs(times.gold));
  });

  it("shows no Medals before Standings arrive", () => {
    mountSetup();
    expect(q(".medal-best").textContent).toContain("No lap yet");
    expect(states()[0]).toBe("bronze:next");
  });

  it("follows the race's Track and Difficulty and badges each Difficulty's Medal", () => {
    const medal = (d: string) => q(`${diff(d)} .diff-medal`).dataset.medal;
    mountSetup().setStandings([
      standing({ difficulty: "hard", bestMs: targets("sunset-ridge", "hard").gold }),
      standing({ track: "stormhaven", bestMs: targets("stormhaven", "medium").bronze }),
    ]);
    expect([medal("easy"), medal("medium"), medal("hard")]).toEqual(["", "", "gold"]);
    expect(q(".medal-best").textContent).toContain("No lap yet");
    click(diff("hard"));
    expect(q(".medal-best").textContent).toContain("Gold medal");
    click(track("stormhaven"));
    expect([medal("easy"), medal("medium"), medal("hard")]).toEqual(["", "bronze", ""]);
    expect(q(".medal-field .medal-targets").textContent).toContain(
      formatMs(targets("stormhaven", "hard").author),
    );
  });
});

describe("Lobby Records medals", () => {
  const times = targets();
  function rowMedals(): (string | undefined)[] {
    return [...parent.querySelectorAll<HTMLElement>(".lb-list .lb-medal")].map(
      (m) => m.dataset.medal,
    );
  }

  it("badges each lap with the Medal its time earned on the browsed board", () => {
    mountSetup().setLeaderboard([
      entry({ name: "Ace", timeMs: times.author }),
      entry({ name: "Gil", timeMs: times.gold + 1 }),
      entry({ name: "Slow", timeMs: times.bronze + 1 }),
      entry({ name: "Storm", timeMs: times.gold + 1, track: "stormhaven" }),
    ]);
    expect(rowMedals()).toEqual(["author", "silver", undefined]);
    click('[data-board-track="stormhaven"]');
    // The same time earns a different Medal on another board.
    expect(rowMedals()).toEqual(["author"]);
  });

  it("lists the browsed board's four targets as a legend", () => {
    mountSetup().setStandings([standing({ bestMs: times.author })]);
    click(boardDiff("hard"));
    const legend = [...parent.querySelectorAll<HTMLElement>(".board-medals .medal-target")];
    expect(legend.map((t) => t.dataset.state)).toEqual(["legend", "legend", "legend", "legend"]);
    expect(legend.map((t) => t.querySelector(".medal-target-time")!.textContent)).toEqual(
      (["bronze", "silver", "gold", "author"] as const).map((m) =>
        formatMs(targets("sunset-ridge", "hard")[m]),
      ),
    );
  });
});

describe("Lobby Rival Pacer option", () => {
  const zed = { name: "Zed", timeMs: 31_440 };

  it("offers the race board's Rival first and arms it as a replay Pacer", () => {
    mountSetup();
    click(track("stormhaven"));
    lobby.setStandings([
      standing({ track: "stormhaven", rival: zed }),
      standing({ rival: { name: "Elsewhere", timeMs: 24_000 } }),
    ]);
    expect(optionTexts()).toEqual(["No Pacer — race alone", `⚑ Next rival: Zed — 0:31.440`]);
    expect(picker().disabled).toBe(false);
    pickPacer("rival");
    expect(lobby.armedPacer).toEqual({
      kind: "replay",
      name: "Zed",
      track: "stormhaven",
      difficulty: "medium",
    });
  });

  it("lists a Rival who is also on the leaderboard once, as the Rival", () => {
    mountSetup().setLeaderboard([
      entry({ name: "Zed", timeMs: zed.timeMs, hasReplay: true }),
      entry({ name: "Carol", timeMs: 63_000, hasReplay: true }),
    ]);
    lobby.setStandings([standing({ rival: zed })]);
    expect(optionTexts().filter((t) => t.includes("Zed"))).toEqual([
      `⚑ Next rival: Zed — 0:31.440`,
    ]);
    pickPacer("rival");
    lobby.setLeaderboard([entry({ name: "Carol", timeMs: 63_000, hasReplay: true })]);
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Zed" });
    expect(picker().value).toBe("rival");
  });

  it("disarms once the ladder moves past the armed Rival", () => {
    mountSetup().setStandings([standing({ bestMs: 32_000, rival: zed })]);
    pickPacer("rival");
    lobby.setStandings([standing({ bestMs: 31_000, rival: { name: "Yan", timeMs: 30_500 } })]);
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
    expect(optionTexts()[1]).toBe(`⚑ Next rival: Yan — 0:30.500`);
  });
});

describe("Lobby locked cars", () => {
  const lockedCards = () =>
    [...parent.querySelectorAll<HTMLElement>(".garage-card.locked")].map((c) => c.dataset.variant);
  const selectDisabled = () => q("[data-select-car]").getAttribute("aria-disabled");
  const silver = standing({ bestMs: targets().silver });

  it("without a Medal, locked cars can be browsed but never selected", () => {
    mount();
    expect(lockedCards()).toEqual(["race", "race-future", "sedan-sports", "police"]);
    expect(q(card("police")).textContent).toContain("Locked. Earn a Gold medal to unlock");
    expect(q(card("race-future")).textContent).toContain("Earn an Author medal to unlock");
    click(card("police"));
    expect(checked(card("police"))).toBe("true");
    expect(q(".hero-car-name").textContent).toBe("Police");
    expect(q(".car-lock-note").textContent).toBe("Earn a Gold medal to unlock");
    expect(selectDisabled()).toBe("true");
    // hello carries the selected car, which is never a locked one.
    expect(lobby.selectedVariant).toBe(FREE);
    expect(cbs.onVariantChange).not.toHaveBeenCalled();
    click("[data-select-car]");
    expect(q(".lobby-deck").dataset.screen).toBe("garage");
    press(q(".car-stage"), "ArrowRight");
    expect(checked(card("van"))).toBe("true");
    expect(selectDisabled()).toBe("false");
    expect(q(".car-lock-note").hidden).toBe(true);
  });

  it("the best Medal on any board unlocks every car up to its tier", () => {
    mount();
    lobby.setStandings([
      standing({ bestMs: targets().bronze }),
      standing({
        track: "stormhaven",
        difficulty: "hard",
        bestMs: targets("stormhaven", "hard").gold,
      }),
    ]);
    expect(lockedCards()).toEqual(["race-future"]);
    expect(q(`${card("police")} .garage-card-lock`).hidden).toBe(true);
  });

  it("keeps a saved locked car and drives it once Standings unlock it", () => {
    localStorage.setItem("racer-variant", "race");
    mount();
    expect(checked(card("race"))).toBe("true");
    expect(lobby.selectedVariant).toBe(FREE);
    expect(localStorage.getItem("racer-variant")).toBe("race");
    lobby.setStandings([silver]);
    expect(lobby.selectedVariant).toBe("race");
    expect(selectDisabled()).toBe("false");
    expect(localStorage.getItem("racer-variant")).toBe("race");
  });

  it("a new driver name races a free car until its own Standings arrive", () => {
    localStorage.setItem("racer-variant", "race");
    mount().setStandings([silver]);
    enterSettings();
    expect(q(".selected-car-name").textContent).toBe("Race");
    const name = q<HTMLInputElement>("#driver-name");
    name.value = "Someone New";
    name.dispatchEvent(new Event("change"));
    expect(cbs.onNameChange).toHaveBeenCalledOnce();
    expect(lobby.selectedVariant).toBe(FREE);
    expect(q(".selected-car-name").textContent).toBe("Hatch S");
    lobby.setStandings([silver]);
    expect(lobby.selectedVariant).toBe("race");
    submitForm();
    expect(cbs.onNameChange).toHaveBeenCalledOnce();
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

  function installBridge(initial: DesktopUpdateState = { status: "unchecked" }): void {
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
  const button = () => parent.querySelector<HTMLButtonElement>(".lobby-nav-aside .update-notice");

  it("is absent in the browser build", () => {
    mount();
    expect(button()).toBeNull();
  });

  it("is absent when the desktop preload predates updates", () => {
    installDesktop({});
    mount();
    expect(button()).toBeNull();
  });

  it("offers a check with the installed version before the first check completes", async () => {
    installBridge();
    await Promise.resolve();
    expect(button()).not.toBeNull();
    expect(button()!.hidden).toBe(false);
    expect(button()!.disabled).toBe(false);
    expect(button()!.textContent).toContain("v0.1.0 · Check for updates");
    expect(button()!.dataset.status).toBe("unchecked");
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

  it("only claims to be up to date once a check has found nothing newer", () => {
    installBridge();
    expect(button()!.textContent).not.toContain("Up to date");
    onStateCb!({ status: "idle" });
    expect(button()!.textContent).toContain("v0.1.0 · Up to date");
    expect(button()!.dataset.status).toBe("idle");
  });

  it.each<[DesktopUpdateState, string, boolean]>([
    [{ status: "checking" }, "Checking for updates…", true],
    [{ status: "available", version: "0.2.0", canInstall: true }, "Update to v0.2.0", false],
    [{ status: "available", version: "0.2.0", canInstall: false }, "Download v0.2.0", false],
    [{ status: "downloading", version: "0.2.0", percent: 42 }, "Updating… 42%", true],
    [{ status: "error", message: "offline" }, "Update check failed · Retry", false],
    [{ status: "unsupported" }, "v0.1.0 · Get updates", false],
  ])("reports %o as '%s'", (state, text, busy) => {
    installBridge();
    onStateCb!(state);
    expect(button()!.hidden).toBe(false);
    expect(button()!.disabled).toBe(busy);
    expect(button()!.textContent).toContain(text);
    expect(button()!.getAttribute("aria-label")).toBe(text);
    expect(button()!.dataset.status).toBe(state.status);
  });

  it("triggers a manual check when clicked before the first check", () => {
    installBridge();
    button()!.click();
    expect(updates.check).toHaveBeenCalledTimes(1);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it("triggers a manual check when clicked while idle", () => {
    installBridge();
    onStateCb!({ status: "idle" });
    button()!.click();
    expect(updates.check).toHaveBeenCalledTimes(1);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it("opens the releases page when clicked in an unsupported install", () => {
    installBridge();
    onStateCb!({ status: "unsupported" });
    button()!.click();
    expect(updates.install).toHaveBeenCalledTimes(1);
    expect(updates.check).not.toHaveBeenCalled();
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
