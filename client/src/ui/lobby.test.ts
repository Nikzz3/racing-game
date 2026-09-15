// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LobbyCallbacks } from "./lobby";
import { DESKTOP_DOWNLOAD_URL, Lobby } from "./lobby";
import {
  CAR_VARIANTS,
  type LeaderboardEntry,
  type RoomInfo,
  type ReplayFrame,
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

function makeReferenceLap(timeMs = 23800): ReferenceLap {
  return {
    name: "AI Record",
    variant: "police",
    track: "sunset-ridge",
    timeMs,
    frames: AI_FRAMES,
  };
}

beforeEach(() => {
  buildReferenceLapMock.mockReset();
  buildReferenceLapMock.mockReturnValue(makeReferenceLap());
});

function makeCallbacks(): LobbyCallbacks {
  return {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onReplay: vi.fn(),
    onReferenceLap: vi.fn(),
    onVariantChange: vi.fn(),
  };
}

function makeParent(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("Lobby track selector cards", () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  it("renders a card for each registered track", () => {
    expect(
      parent.querySelector('button[data-track="sunset-ridge"]'),
    ).not.toBeNull();
    expect(
      parent.querySelector('button[data-track="stormhaven"]'),
    ).not.toBeNull();
  });

  it("Sunset Ridge card is active by default", () => {
    expect(
      parent
        .querySelector<HTMLElement>('button[data-track="sunset-ridge"]')!
        .classList.contains("active"),
    ).toBe(true);
    expect(
      parent
        .querySelector<HTMLElement>('button[data-track="stormhaven"]')!
        .classList.contains("active"),
    ).toBe(false);
  });

  it("clicking Stormhaven marks it active and deactivates Sunset Ridge", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    expect(
      parent
        .querySelector<HTMLElement>('button[data-track="stormhaven"]')!
        .classList.contains("active"),
    ).toBe(true);
    expect(
      parent
        .querySelector<HTMLElement>('button[data-track="sunset-ridge"]')!
        .classList.contains("active"),
    ).toBe(false);
  });

  it("track cards contain the track name", () => {
    expect(
      parent.querySelector('button[data-track="sunset-ridge"]')!.textContent,
    ).toContain("Sunset Ridge Circuit");
    expect(
      parent.querySelector('button[data-track="stormhaven"]')!.textContent,
    ).toContain("Stormhaven Circuit");
  });

  it("selecting Stormhaven filters the leaderboard to Stormhaven entries", () => {
    const entries: LeaderboardEntry[] = [
      {
        name: "Alice",
        timeMs: 60000,
        date: "2026-01-01",
        hasReplay: false,
        difficulty: "medium",
        track: "sunset-ridge",
      },
      {
        name: "Bob",
        timeMs: 65000,
        date: "2026-01-02",
        hasReplay: false,
        difficulty: "medium",
        track: "stormhaven",
      },
    ];
    lobby.setLeaderboard(entries);
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    const lb = parent.querySelector(".lb-list")!.textContent ?? "";
    expect(lb).toContain("Bob");
    expect(lb).not.toContain("Alice");
  });
});

describe("Lobby unified difficulty selector", () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  it("has a unified difficulty button for each difficulty", () => {
    expect(parent.querySelector('button[data-diff="easy"]')).not.toBeNull();
    expect(parent.querySelector('button[data-diff="medium"]')).not.toBeNull();
    expect(parent.querySelector('button[data-diff="hard"]')).not.toBeNull();
  });

  it("the Records board has its own difficulty radios that never carry data-diff", () => {
    const boardRadios = parent.querySelectorAll("button[data-board-diff]");
    expect(boardRadios).toHaveLength(3);
    boardRadios.forEach((b) => expect(b.hasAttribute("data-diff")).toBe(false));
  });

  it("clicking hard filters the leaderboard to hard entries", () => {
    const entries: LeaderboardEntry[] = [
      {
        name: "Alice",
        timeMs: 60000,
        date: "2026-01-01",
        hasReplay: false,
        difficulty: "medium",
        track: "sunset-ridge",
      },
      {
        name: "Bob",
        timeMs: 55000,
        date: "2026-01-02",
        hasReplay: false,
        difficulty: "hard",
        track: "sunset-ridge",
      },
    ];
    lobby.setLeaderboard(entries);
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="hard"]')!
      .click();
    const lb = parent.querySelector(".lb-list")!.textContent ?? "";
    expect(lb).toContain("Bob");
    expect(lb).not.toContain("Alice");
  });
});

describe("Lobby create-room callback", () => {
  let parent: HTMLElement;
  let cbs: LobbyCallbacks;
  let lobby: Lobby;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  function submitForm(): void {
    parent
      .querySelector<HTMLFormElement>(".create-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  it("submitting the form calls onCreate with default track (sunset-ridge) and difficulty (medium)", () => {
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "sunset-ridge",
      "medium",
    );
  });

  it("onCreate includes selected track after switching to Stormhaven", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "stormhaven",
      "medium",
    );
  });

  it("onCreate includes selected difficulty after switching to hard", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="hard"]')!
      .click();
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "sunset-ridge",
      "hard",
    );
  });
});

describe("Lobby room list tracks", () => {
  let parent: HTMLElement;
  let lobby: Lobby;

  beforeEach(() => {
    parent = makeParent();
    lobby = new Lobby(parent, makeCallbacks());
  });
  afterEach(() => parent.remove());

  it("room rows show the track name for Stormhaven", () => {
    lobby.setRooms([
      {
        id: "r1",
        name: "Test Room",
        players: 2,
        difficulty: "medium",
        track: "stormhaven",
      } as RoomInfo,
    ]);
    expect(parent.querySelector(".room-list")!.textContent).toContain(
      "Stormhaven Circuit",
    );
  });

  it("room rows show the track name for Sunset Ridge", () => {
    lobby.setRooms([
      {
        id: "r2",
        name: "Another Room",
        players: 1,
        difficulty: "hard",
        track: "sunset-ridge",
      } as RoomInfo,
    ]);
    expect(parent.querySelector(".room-list")!.textContent).toContain(
      "Sunset Ridge Circuit",
    );
  });
});

describe("Lobby Pacer arming UX", () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  const replayEntry: LeaderboardEntry = {
    name: "Alice",
    timeMs: 62340,
    date: "2026-01-01",
    hasReplay: true,
    difficulty: "medium",
    track: "sunset-ridge",
  };
  const noReplayEntry: LeaderboardEntry = {
    name: "Bob",
    timeMs: 65000,
    date: "2026-01-02",
    hasReplay: false,
    difficulty: "medium",
    track: "sunset-ridge",
  };
  const replayEntry2: LeaderboardEntry = {
    name: "Carol",
    timeMs: 63000,
    date: "2026-01-03",
    hasReplay: true,
    difficulty: "medium",
    track: "sunset-ridge",
  };

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
    lobby.setLeaderboard([replayEntry, noReplayEntry, replayEntry2]);
  });
  afterEach(() => parent.remove());

  function picker(): HTMLSelectElement {
    return parent.querySelector<HTMLSelectElement>(".pacer-select")!;
  }

  /** Selects the option naming `name` (or "No Pacer" when null) and fires change. */
  function pickPacer(name: string | null): void {
    const sel = picker();
    sel.value =
      name === null
        ? "-1"
        : [...sel.options].find((o) => o.textContent!.includes(name))!.value;
    sel.dispatchEvent(new Event("change"));
  }

  it("picker lives in the Starting Grid panel", () => {
    expect(parent.querySelector(".panel-rooms .pacer-select")).not.toBeNull();
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
    const texts = [...picker().options].map((o) => o.textContent!);
    expect(texts.some((t) => t.includes("Alice"))).toBe(true);
    expect(texts.some((t) => t.includes("Carol"))).toBe(true);
    expect(texts.some((t) => t.includes("Bob"))).toBe(false);
  });

  it("options show a formatted lap time", () => {
    const alice = [...picker().options].find((o) =>
      o.textContent!.includes("Alice"),
    )!;
    expect(alice.textContent).toContain("1:02");
  });

  it('picking an entry arms it as a kind:"replay" Pacer', () => {
    pickPacer("Alice");
    expect(lobby.armedPacer).toEqual({
      kind: "replay",
      name: "Alice",
      track: "sunset-ridge",
      difficulty: "medium",
      entry: replayEntry,
    });
  });

  it('picking "No Pacer" clears the armed entry', () => {
    pickPacer("Alice");
    pickPacer(null);
    expect(lobby.armedPacer).toBeNull();
  });

  it("picking a new entry replaces the previous one", () => {
    pickPacer("Alice");
    pickPacer("Carol");
    expect(lobby.armedPacer).toMatchObject({
      kind: "replay",
      entry: replayEntry2,
    });
  });

  it("only offers entries matching selected Track and Difficulty", () => {
    const otherTrackEntry: LeaderboardEntry = {
      name: "Dave",
      timeMs: 60000,
      date: "2026-01-04",
      hasReplay: true,
      difficulty: "medium",
      track: "stormhaven",
    };
    lobby.setLeaderboard([replayEntry, otherTrackEntry]);
    // Default view is sunset-ridge / medium — Dave (stormhaven) should not be offered
    const texts = [...picker().options].map((o) => o.textContent!);
    expect(texts.some((t) => t.includes("Alice"))).toBe(true);
    expect(texts.some((t) => t.includes("Dave"))).toBe(false);
  });

  it("switching Track clears the armed Pacer and resets the picker", () => {
    pickPacer("Alice");
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
  });

  it("the armed Pacer survives a leaderboard refresh with new entry objects", () => {
    pickPacer("Alice");
    lobby.setLeaderboard([{ ...replayEntry }, noReplayEntry, replayEntry2]);
    expect(lobby.armedPacer).toMatchObject({
      kind: "replay",
      entry: replayEntry,
    });
    expect(picker().value).not.toBe("-1");
  });

  it("is disabled when no entry has a replay and the AI is ineligible", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="hard"]')!
      .click();
    lobby.setLeaderboard([{ ...noReplayEntry, difficulty: "hard" }]);
    expect(picker().disabled).toBe(true);
  });

  it("is enabled with no replay-bearing entries when the AI option is offered", () => {
    lobby.setLeaderboard([noReplayEntry]);
    expect(picker().disabled).toBe(false);
  });
});

describe("Lobby AI Record Pacer option", () => {
  let parent: HTMLElement;
  let lobby: Lobby;

  const alice: LeaderboardEntry = {
    name: "Alice",
    timeMs: 22000,
    date: "2026-01-01",
    hasReplay: true,
    difficulty: "medium",
    track: "sunset-ridge",
  };
  const carol: LeaderboardEntry = {
    name: "Carol",
    timeMs: 63000,
    date: "2026-01-03",
    hasReplay: true,
    difficulty: "medium",
    track: "sunset-ridge",
  };

  beforeEach(() => {
    parent = makeParent();
  });
  afterEach(() => parent.remove());

  function makeLobby(): Lobby {
    lobby = new Lobby(parent, makeCallbacks());
    return lobby;
  }

  function picker(): HTMLSelectElement {
    return parent.querySelector<HTMLSelectElement>(".pacer-select")!;
  }

  function aiOption(): HTMLOptionElement | undefined {
    return [...picker().options].find((o) => o.value === "ai");
  }

  function pick(value: string): void {
    picker().value = value;
    picker().dispatchEvent(new Event("change"));
  }

  it("offers the AI Record with the baked time when eligible", () => {
    buildReferenceLapMock.mockReturnValue(makeReferenceLap(24680));
    makeLobby();
    const opt = aiOption();
    expect(opt).toBeDefined();
    // The displayed time is the bake's, never a literal.
    expect(opt!.textContent).toBe(`⚑ AI Record — ${formatMs(24680)}`);
  });

  it("is styled to match the Pacer cyan", () => {
    makeLobby();
    expect(aiOption()!.classList.contains("pacer-opt-ai")).toBe(true);
  });

  it("sits at its time-sorted position among the human options", () => {
    // Alice 22.0s < AI 23.8s < Carol 63.0s
    makeLobby().setLeaderboard([alice, carol]);
    const texts = [...picker().options].map((o) => o.textContent!);
    expect(texts).toEqual([
      "No Pacer — race alone",
      `⚑ Alice — ${formatMs(22000)}`,
      `⚑ AI Record — ${formatMs(23800)}`,
      `⚑ Carol — ${formatMs(63000)}`,
    ]);
  });

  it("is absent on a Track without a trained policy", () => {
    makeLobby();
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    expect(aiOption()).toBeUndefined();
  });

  it("is absent on a non-Medium Difficulty", () => {
    makeLobby();
    for (const diff of ["easy", "hard"]) {
      parent
        .querySelector<HTMLButtonElement>(`button[data-diff="${diff}"]`)!
        .click();
      expect(aiOption()).toBeUndefined();
    }
  });

  it("a null bake yields no AI option", () => {
    buildReferenceLapMock.mockReturnValue(null);
    makeLobby();
    expect(aiOption()).toBeUndefined();
  });

  it('selecting it arms a kind:"ai" Pacer whose frames are the memoized bake', () => {
    makeLobby();
    pick("ai");
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
    makeLobby().setLeaderboard([alice]);
    pick("ai");
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
    pick("0");
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", entry: alice });
    pick("ai");
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
  });

  it("switching Track to an ineligible context clears an armed AI Pacer", () => {
    makeLobby();
    pick("ai");
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
  });

  it("switching Difficulty to an ineligible context clears an armed AI Pacer", () => {
    makeLobby();
    pick("ai");
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="hard"]')!
      .click();
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe("-1");
  });

  it("an armed AI Pacer survives eligible re-renders (leaderboard refreshes)", () => {
    makeLobby();
    pick("ai");
    lobby.setLeaderboard([alice, carol]);
    expect(lobby.armedPacer).toMatchObject({ kind: "ai" });
    expect(picker().value).toBe("ai");
  });

  it("bakes at most once across repeated renders", () => {
    makeLobby();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="hard"]')!
      .click();
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="medium"]')!
      .click();
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
  });

  it("does not bake again for ineligible renders", () => {
    makeLobby();
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    buildReferenceLapMock.mockClear();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([]);
    expect(buildReferenceLapMock).not.toHaveBeenCalled();
  });

  it("a null bake is memoized too", () => {
    buildReferenceLapMock.mockReturnValue(null);
    makeLobby();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
  });
});

describe("Lobby AI Record control", () => {
  let parent: HTMLElement;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  it("is visible for Sunset Ridge + Medium (default state)", () => {
    expect(parent.querySelector<HTMLElement>(".lb-ai-record")!.hidden).toBe(
      false,
    );
  });

  it("is hidden when Stormhaven is selected (no policy)", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    expect(parent.querySelector<HTMLElement>(".lb-ai-record")!.hidden).toBe(
      true,
    );
  });

  it("is hidden when Easy is selected for Sunset Ridge", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="easy"]')!
      .click();
    expect(parent.querySelector<HTMLElement>(".lb-ai-record")!.hidden).toBe(
      true,
    );
  });

  it("is hidden when Hard is selected for Sunset Ridge", () => {
    parent
      .querySelector<HTMLButtonElement>('button[data-diff="hard"]')!
      .click();
    expect(parent.querySelector<HTMLElement>(".lb-ai-record")!.hidden).toBe(
      true,
    );
  });

  it("clicking the AI Record button invokes onReferenceLap", () => {
    const btn = parent.querySelector<HTMLButtonElement>(
      "button[data-ai-record]",
    );
    expect(btn).not.toBeNull();
    btn!.click();
    expect(cbs.onReferenceLap).toHaveBeenCalledOnce();
  });

  it("onReferenceLap is not triggered by clicks on other leaderboard elements", () => {
    parent.querySelector<HTMLElement>(".lb-list")!.click();
    expect(cbs.onReferenceLap).not.toHaveBeenCalled();
  });
});

describe("Lobby Garage picker", () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    localStorage.clear();
    parent = makeParent();
  });
  afterEach(() => {
    parent.remove();
    localStorage.clear();
  });

  function makeLobby(): Lobby {
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
    return lobby;
  }

  function card(variant: string): HTMLElement {
    return parent.querySelector<HTMLElement>(
      `.garage-card[data-variant="${variant}"]`,
    )!;
  }

  function selectCar(variant: string): void {
    const next = parent.querySelector<HTMLButtonElement>(
      '[data-carousel="next"]',
    )!;
    for (let i = 0; i <= CAR_VARIANTS.length; i++) {
      if (card(variant).classList.contains("active")) return;
      next.click();
    }
    throw new Error(`Could not select ${variant}`);
  }

  it("renders a card for each of the 8 Variants plus a Random tile", () => {
    makeLobby();
    expect(parent.querySelectorAll(".garage-card").length).toBe(
      CAR_VARIANTS.length + 1,
    );
    for (const v of CAR_VARIANTS) {
      expect(card(v)).not.toBeNull();
    }
    expect(card("random")).not.toBeNull();
  });

  it("car choices are on the garage screen and settings start inaccessible", () => {
    makeLobby();
    expect(parent.querySelector(".garage-screen .garage")).not.toBeNull();
    expect(
      parent.querySelector(".settings-screen .diff-picker"),
    ).not.toBeNull();
    expect(
      parent.querySelector(".settings-screen")!.hasAttribute("inert"),
    ).toBe(true);
    expect(
      parent.querySelector(".settings-screen")!.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("cards carry the Variant display name, with no separate selected-state line", () => {
    makeLobby();
    expect(card("suv").textContent).toContain("SUV");
    expect(card("random").textContent).toContain("Random");
    expect(parent.querySelector(".garage-selected")).toBeNull();
  });

  it("pre-selects Random on first visit", () => {
    makeLobby();
    expect(card("random").classList.contains("active")).toBe(true);
    expect(parent.querySelectorAll(".garage-card.active").length).toBe(1);
  });

  it("clicking a garage card selects that model directly", () => {
    makeLobby();
    card("police").click();
    expect(card("police").classList.contains("active")).toBe(true);
    expect(card("police").getAttribute("aria-checked")).toBe("true");
    expect(card("police").tabIndex).toBe(0);
    expect(card("random").getAttribute("aria-checked")).toBe("false");
    expect(card("random").tabIndex).toBe(-1);
    expect(lobby.selectedVariant).toBe("police");
    expect(localStorage.getItem("racer-variant")).toBe("police");
    expect(parent.querySelectorAll(".garage-card.active").length).toBe(1);
  });

  it("cycling to a model stores the choice and moves the highlight", () => {
    makeLobby();
    selectCar("suv");
    expect(localStorage.getItem("racer-variant")).toBe("suv");
    expect(card("suv").classList.contains("active")).toBe(true);
    expect(card("random").classList.contains("active")).toBe(false);
    expect(lobby.selectedVariant).toBe("suv");
  });

  it("a stored concrete Variant renders as the selected card", () => {
    localStorage.setItem("racer-variant", "taxi");
    makeLobby();
    expect(card("taxi").classList.contains("active")).toBe(true);
    expect(lobby.selectedVariant).toBe("taxi");
  });

  it("a stored Random choice stays Random", () => {
    localStorage.setItem("racer-variant", "random");
    makeLobby();
    expect(card("random").classList.contains("active")).toBe(true);
    expect(localStorage.getItem("racer-variant")).toBe("random");
  });

  it("an invalid stored value falls back to Random and overwrites the stored value", () => {
    localStorage.setItem("racer-variant", "batmobile");
    makeLobby();
    expect(card("random").classList.contains("active")).toBe(true);
    expect(localStorage.getItem("racer-variant")).toBe("random");
  });

  it('Random resolves to a concrete member of CAR_VARIANTS, never the wire string "random"', () => {
    makeLobby();
    expect(CAR_VARIANTS).toContain(lobby.selectedVariant);
  });

  it("Random keeps a single roll for the connection", () => {
    makeLobby();
    const first = lobby.selectedVariant;
    selectCar("suv");
    selectCar("random");
    expect(lobby.selectedVariant).toBe(first);
  });

  it("a choice change triggers a hello re-send", () => {
    makeLobby();
    parent.querySelector<HTMLButtonElement>('[data-carousel="next"]')!.click();
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    parent
      .querySelector<HTMLButtonElement>('[data-carousel="previous"]')!
      .click();
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(2);
  });

  it("clicking model indicators notifies once per change and ignores repeats", () => {
    makeLobby();
    card("suv").click();
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    card("suv").click();
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    card("random").click();
    expect(card("random").classList.contains("active")).toBe(true);
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(2);
  });

  it("painting thumbnails without WebGL leaves the cards name-only", () => {
    makeLobby();
    expect(() => lobby.paintGarageThumbnails()).not.toThrow();
    for (const img of parent.querySelectorAll<HTMLImageElement>(
      ".garage-card img",
    )) {
      expect(img.getAttribute("src")).toBeNull();
    }
  });

  it("cycles across every car and Random, wrapping in both directions", () => {
    makeLobby();
    const next = parent.querySelector<HTMLButtonElement>(
      '[data-carousel="next"]',
    )!;
    const previous = parent.querySelector<HTMLButtonElement>(
      '[data-carousel="previous"]',
    )!;
    for (const variant of CAR_VARIANTS) {
      next.click();
      expect(card(variant).getAttribute("aria-checked")).toBe("true");
      expect(
        parent
          .querySelector('.car-slide[data-position="current"]')!
          .getAttribute("data-slide"),
      ).toBe(variant);
    }
    next.click();
    expect(card("random").getAttribute("aria-checked")).toBe("true");
    previous.click();
    expect(card(CAR_VARIANTS.at(-1)!).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("requires car and track confirmation before entering settings", () => {
    makeLobby();
    selectCar("police");
    const settings = parent.querySelector<HTMLElement>(".settings-screen")!;
    expect(settings.hasAttribute("inert")).toBe(true);
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    expect(settings.hasAttribute("inert")).toBe(true);
    expect(parent.querySelector(".track-screen")!.hasAttribute("inert")).toBe(
      false,
    );
    expect(document.activeElement).toBe(
      parent.querySelector("[data-select-track]"),
    );
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    expect(settings.hasAttribute("inert")).toBe(false);
    expect(settings.getAttribute("aria-hidden")).toBe("false");
    expect(parent.querySelector(".garage-screen")!.hasAttribute("inert")).toBe(
      true,
    );
    expect(parent.querySelector(".track-screen")!.hasAttribute("inert")).toBe(
      true,
    );
    expect(document.activeElement).toBe(
      parent.querySelector('[data-setup-tab="race"]'),
    );
  });

  it("preserves setup values when changing the car", () => {
    makeLobby();
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    parent.querySelector<HTMLInputElement>("#driver-name")!.value =
      "Night Driver";
    parent.querySelector<HTMLInputElement>(".create-form input")!.value =
      "Final lap";
    parent
      .querySelector<HTMLButtonElement>('[data-track="stormhaven"]')!
      .click();
    parent.querySelector<HTMLButtonElement>('[data-diff="hard"]')!.click();
    parent.querySelector<HTMLButtonElement>("[data-change-car]")!.click();
    expect(
      parent.querySelector(".settings-screen")!.hasAttribute("inert"),
    ).toBe(true);
    selectCar("van");
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    expect(lobby.playerName).toBe("Night Driver");
    expect(
      parent.querySelector<HTMLInputElement>(".create-form input")!.value,
    ).toBe("Final lap");
    expect(
      parent
        .querySelector('[data-track="stormhaven"]')!
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      parent.querySelector('[data-diff="hard"]')!.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("supports arrow navigation from the car stage and does not intercept typing", () => {
    makeLobby();
    const stage = parent.querySelector<HTMLElement>(".car-stage")!;
    stage.focus();
    stage.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(stage);
    expect(lobby.selectedVariant).toBe(CAR_VARIANTS[0]);
    expect(parent.querySelectorAll('.garage-card[tabindex="0"]')).toHaveLength(
      1,
    );
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    parent
      .querySelector<HTMLInputElement>("#driver-name")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    expect(lobby.selectedVariant).toBe(CAR_VARIANTS[0]);
  });

  it("dragging never changes the selected car", () => {
    makeLobby();
    const stage = parent.querySelector(".car-stage")!;
    stage.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 220, clientY: 120 }),
    );
    stage.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 90, clientY: 130 }),
    );
    expect(card("random").getAttribute("aria-checked")).toBe("true");
    stage.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 220, clientY: 120 }),
    );
    stage.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 190, clientY: 280 }),
    );
    expect(card("random").getAttribute("aria-checked")).toBe("true");
    expect(cbs.onVariantChange).not.toHaveBeenCalled();
  });

  it("cycles full track previews and preserves the circuit when returning from settings", () => {
    makeLobby();
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    parent
      .querySelector<HTMLButtonElement>('[data-track-carousel="next"]')!
      .click();
    expect(
      parent
        .querySelector(".track-slide.active")!
        .getAttribute("data-track-slide"),
    ).toBe("stormhaven");
    expect(parent.querySelector(".hero-track-name")!.textContent).toBe(
      "Stormhaven Circuit",
    );
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    parent.querySelector<HTMLButtonElement>("[data-change-track]")!.click();
    expect(
      parent.querySelector(".lobby-deck")!.getAttribute("data-screen"),
    ).toBe("track");
    expect(
      parent.querySelector(".track-card.active")!.getAttribute("data-track"),
    ).toBe("stormhaven");
    parent
      .querySelector<HTMLButtonElement>('[data-track-carousel="next"]')!
      .click();
    expect(
      parent
        .querySelector(".track-slide.active")!
        .getAttribute("data-track-slide"),
    ).toBe("sunset-ridge");
  });

  it("switches setup panels without losing the race form or pacer", () => {
    makeLobby();
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    parent.querySelector<HTMLInputElement>(".create-form input")!.value =
      "Last light";
    const picker = parent.querySelector<HTMLSelectElement>(".pacer-select")!;
    picker.value = "ai";
    picker.dispatchEvent(new Event("change"));
    parent
      .querySelector<HTMLButtonElement>('[data-setup-tab="records"]')!
      .click();
    expect(
      parent.querySelector<HTMLElement>('[data-setup-panel="race"]')!.hidden,
    ).toBe(true);
    expect(
      parent.querySelector<HTMLElement>('[data-setup-panel="records"]')!.hidden,
    ).toBe(false);
    parent.querySelector<HTMLButtonElement>('[data-setup-tab="race"]')!.click();
    expect(
      parent.querySelector<HTMLInputElement>(".create-form input")!.value,
    ).toBe("Last light");
    expect(lobby.armedPacer?.kind).toBe("ai");
    expect(
      parent.querySelectorAll('[data-setup-tab][tabindex="0"]'),
    ).toHaveLength(1);
  });
});

describe("Lobby difficulty keyboard navigation", () => {
  it("uses one tab stop, wraps radios and clears an incompatible pacer", () => {
    const parent = makeParent();
    try {
      const lobby = new Lobby(parent, makeCallbacks());
      parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
      parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
      const picker = parent.querySelector<HTMLSelectElement>(".pacer-select")!;
      picker.value = "ai";
      picker.dispatchEvent(new Event("change"));
      const medium = parent.querySelector<HTMLButtonElement>(
        '.diff-opt[data-diff="medium"]',
      )!;
      medium.focus();
      expect(parent.querySelectorAll('.diff-opt[tabindex="0"]')).toHaveLength(
        1,
      );
      medium.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
      const hard = parent.querySelector<HTMLButtonElement>(
        '.diff-opt[data-diff="hard"]',
      )!;
      expect(document.activeElement).toBe(hard);
      expect(hard.getAttribute("aria-checked")).toBe("true");
      expect(medium.tabIndex).toBe(-1);
      expect(lobby.armedPacer).toBeNull();
      hard.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(document.activeElement).toBe(
        parent.querySelector('.diff-opt[data-diff="easy"]'),
      );
      expect(parent.querySelectorAll('.diff-opt[tabindex="0"]')).toHaveLength(
        1,
      );
    } finally {
      parent.remove();
    }
  });
});

describe("Lobby Records board filters", () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  const sunsetMedium: LeaderboardEntry = {
    name: "Alice",
    timeMs: 60000,
    date: "2026-01-01",
    hasReplay: true,
    difficulty: "medium",
    track: "sunset-ridge",
  };
  const sunsetHard: LeaderboardEntry = {
    name: "Bob",
    timeMs: 55000,
    date: "2026-01-02",
    hasReplay: false,
    difficulty: "hard",
    track: "sunset-ridge",
  };
  const stormMedium: LeaderboardEntry = {
    name: "Carol",
    timeMs: 65000,
    date: "2026-01-03",
    hasReplay: true,
    difficulty: "medium",
    track: "stormhaven",
  };

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
    lobby.setLeaderboard([sunsetMedium, sunsetHard, stormMedium]);
  });
  afterEach(() => parent.remove());

  function names(): string[] {
    return [...parent.querySelectorAll(".lb-list .lb-name")].map(
      (n) => n.textContent!,
    );
  }
  function boardDiff(d: string): HTMLButtonElement {
    return parent.querySelector<HTMLButtonElement>(
      `.board-diff-opt[data-board-diff="${d}"]`,
    )!;
  }
  function raceDiff(d: string): HTMLButtonElement {
    return parent.querySelector<HTMLButtonElement>(
      `.diff-opt[data-diff="${d}"]`,
    )!;
  }
  function boardTrackValue(): string | undefined {
    return parent.querySelector<HTMLElement>(
      '.board-track-opt[aria-selected="true"]',
    )?.dataset.boardTrack;
  }
  function pickBoardTrack(slug: string): void {
    parent
      .querySelector<HTMLButtonElement>(`[data-board-track="${slug}"]`)!
      .click();
  }
  function note(): HTMLElement {
    return parent.querySelector<HTMLElement>(".board-note")!;
  }
  function submitCreate(): void {
    parent
      .querySelector<HTMLFormElement>(".create-form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
  }

  it("board filters default to the race selection and follow it", () => {
    expect(boardDiff("medium").getAttribute("aria-checked")).toBe("true");
    expect(boardTrackValue()).toBe("sunset-ridge");
    expect(note().hidden).toBe(true);
    raceDiff("hard").click();
    parent
      .querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!
      .click();
    expect(boardDiff("hard").getAttribute("aria-checked")).toBe("true");
    expect(boardTrackValue()).toBe("stormhaven");
    expect(note().hidden).toBe(true);
  });

  it("changing board difficulty re-filters the list without touching the race", () => {
    expect(names()).toEqual(["Alice"]);
    boardDiff("hard").click();
    expect(names()).toEqual(["Bob"]);
    // Differing on difficulty alone is enough to show the browsing note.
    expect(note().hidden).toBe(false);
    expect(boardDiff("hard").classList.contains("active")).toBe(true);
    expect(boardDiff("medium").getAttribute("aria-checked")).toBe("false");
    // Race picker is untouched.
    expect(raceDiff("medium").classList.contains("active")).toBe(true);
    expect(raceDiff("hard").getAttribute("aria-checked")).toBe("false");
    submitCreate();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "sunset-ridge",
      "medium",
    );
  });

  it("changing board track re-filters the list and keeps the pacer on the race", () => {
    const picker = parent.querySelector<HTMLSelectElement>(".pacer-select")!;
    picker.value = "0";
    picker.dispatchEvent(new Event("change"));
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Alice" });
    pickBoardTrack("stormhaven");
    expect(names()).toEqual(["Carol"]);
    // Differing on track alone is enough to show the browsing note.
    expect(note().hidden).toBe(false);
    // Pacer choices and the armed pacer still belong to the race setup.
    expect(lobby.armedPacer).toMatchObject({ kind: "replay", name: "Alice" });
    const texts = [...picker.options].map((o) => o.textContent!);
    expect(texts.some((t) => t.includes("Alice"))).toBe(true);
    expect(texts.some((t) => t.includes("Carol"))).toBe(false);
    expect(parent.querySelector(".selected-track-name")!.textContent).toContain(
      "Sunset Ridge",
    );
  });

  it("replay buttons carry the browsed entry's track and difficulty", () => {
    pickBoardTrack("stormhaven");
    parent.querySelector<HTMLButtonElement>(".lb-replay")!.click();
    expect(cbs.onReplay).toHaveBeenCalledWith("Carol", "stormhaven", "medium");
  });

  it("shows the browsing note when filters differ; Use these settings syncs the race", () => {
    boardDiff("hard").click();
    pickBoardTrack("stormhaven");
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain(
      "Browsing only. Your race is still Sunset Ridge Circuit, Medium.",
    );
    const use = parent.querySelector<HTMLButtonElement>(".board-use-settings")!;
    use.focus();
    use.click();
    expect(note().hidden).toBe(true);
    // Focus moves off the now-hidden note rather than dropping to <body>.
    expect(document.activeElement).toBe(boardDiff("hard"));
    expect(raceDiff("hard").classList.contains("active")).toBe(true);
    expect(
      parent
        .querySelector('.track-card[data-track="stormhaven"]')!
        .getAttribute("aria-checked"),
    ).toBe("true");
    submitCreate();
    expect(cbs.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      "stormhaven",
      "hard",
    );
  });

  it("the empty state names the browsed track and difficulty", () => {
    boardDiff("easy").click();
    pickBoardTrack("stormhaven");
    const empty = parent.querySelector<HTMLElement>(".lb-empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector(".empty-timer")).not.toBeNull();
    expect(empty.textContent).toContain(
      "No laps yet on Stormhaven Circuit, Easy.",
    );
  });

  it("the AI Record button follows the board, not the race", () => {
    const ai = parent.querySelector<HTMLElement>(".lb-ai-record")!;
    expect(ai.hidden).toBe(false);
    boardDiff("hard").click();
    expect(ai.hidden).toBe(true);
    boardDiff("medium").click();
    raceDiff("hard").click(); // syncs board to hard too
    expect(ai.hidden).toBe(true);
    boardDiff("medium").click();
    expect(ai.hidden).toBe(false);
  });

  it("supports roving tabindex and arrow/Home/End keys on the board radiogroup", () => {
    parent.querySelector<HTMLButtonElement>("[data-select-car]")!.click();
    parent.querySelector<HTMLButtonElement>("[data-select-track]")!.click();
    const key = (el: HTMLElement, k: string) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(
      parent.querySelectorAll('.board-diff-opt[tabindex="0"]'),
    ).toHaveLength(1);
    boardDiff("medium").focus();
    key(boardDiff("medium"), "ArrowRight");
    expect(document.activeElement).toBe(boardDiff("hard"));
    expect(boardDiff("hard").getAttribute("aria-checked")).toBe("true");
    expect(boardDiff("medium").tabIndex).toBe(-1);
    expect(names()).toEqual(["Bob"]);
    key(boardDiff("hard"), "ArrowRight"); // wraps
    expect(document.activeElement).toBe(boardDiff("easy"));
    key(boardDiff("easy"), "ArrowLeft"); // wraps back
    expect(document.activeElement).toBe(boardDiff("hard"));
    key(boardDiff("hard"), "Home");
    expect(document.activeElement).toBe(boardDiff("easy"));
    key(boardDiff("easy"), "End");
    expect(document.activeElement).toBe(boardDiff("hard"));
    // The race difficulty never moved.
    expect(raceDiff("medium").getAttribute("aria-checked")).toBe("true");
    expect(parent.querySelectorAll('.diff-opt[tabindex="0"]')).toHaveLength(1);
  });
});

describe("Lobby desktop download notice", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = makeParent();
  });
  afterEach(() => {
    parent.remove();
    Reflect.deleteProperty(window, "desktop");
  });

  it("links to the GitHub releases page in the browser build", () => {
    new Lobby(parent, makeCallbacks());
    const link = parent.querySelector<HTMLAnchorElement>(
      ".lobby-nav .desktop-notice",
    );
    expect(link).not.toBeNull();
    expect(link!.href).toBe(DESKTOP_DOWNLOAD_URL);
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toBe("noopener noreferrer");
    expect(link!.textContent).toContain("Download for macOS, Windows & Linux");
    expect(link!.getAttribute("aria-label")).toMatch(/macOS, Windows and Linux/);
  });

  it("is absent inside the desktop app (window.desktop defined)", () => {
    Object.defineProperty(window, "desktop", {
      value: { serverUrl: "wss://play.example.com" },
      configurable: true,
    });
    new Lobby(parent, makeCallbacks());
    expect(parent.querySelector(".desktop-notice")).toBeNull();
    expect(parent.querySelector(".connection-status")).not.toBeNull();
  });
});
