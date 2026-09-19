import {
  asVariant,
  CAR_VARIANTS,
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  TRACKS,
  resolveTrack,
  trackPath,
  type Difficulty,
  type LeaderboardEntry,
  type ReplayFrame,
  type RoomInfo,
  type Track,
  type TrackSlug,
  type Variant,
} from "@racing/shared";
import { renderVariantThumbnails } from "./garage-thumbs";
import { GarageStage } from "./garage-stage";
import { TrackStage } from "./track-stage";
import { buildReferenceLap, type ReferenceLap } from "../game/reference-lap";
import type { ConnectionState } from "../net";
import policy from "../../../rl/policy.json";
import { escapeHtml as html, formatMs } from "../util";

export interface LobbyCallbacks {
  onCreate(roomName: string, track: TrackSlug, difficulty: Difficulty): void;
  onJoin(roomId: string): void;
  onReplay(name: string, track: TrackSlug, difficulty: Difficulty): void;
  onReferenceLap(): void;
  onVariantChange(): void;
}
export type ArmedPacer =
  | {
      kind: "replay";
      name: string;
      track: TrackSlug;
      difficulty: Difficulty;
      entry: LeaderboardEntry;
    }
  | {
      kind: "ai";
      name: "AI Record";
      track: TrackSlug;
      difficulty: "medium";
      variant: "police";
      frames: ReplayFrame[];
    };
type Choice = Variant | "random";
type Screen = "garage" | "track" | "settings";
type SetupTab = "race" | "records";
const CHOICES: readonly Choice[] = [...CAR_VARIANTS, "random"];
const TRACK_IDS = TRACKS.map((t) => t.id);
const SETUP_TABS: readonly SetupTab[] = ["race", "records"];
const CAR_COUNT = String(CAR_VARIANTS.length).padStart(2, "0");
const LABELS: Record<Variant, string> = {
  race: "Race",
  "race-future": "Hyper",
  "sedan-sports": "Sedan S",
  "hatchback-sports": "Hatch S",
  suv: "SUV",
  taxi: "Taxi",
  police: "Police",
  van: "Van",
};
/** GitHub releases page where the desktop installers (`v*` tags) are published. */
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/Nikzz3/racing-game/releases";

function label(choice: Choice): string {
  return choice === "random" ? "Random" : LABELS[choice];
}
/**
 * Link to the desktop installers, shown only in the browser build: inside the Electron
 * app `window.desktop` is present and the notice would be noise.
 */
function desktopNotice(): string {
  if (window.desktop !== undefined) return "";
  return `<a class="desktop-notice" href="${DESKTOP_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer" aria-label="Download the desktop app for macOS, Windows and Linux"><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M5.5 14h5M8 11v3M8 4.5v4M6.3 7l1.7 1.7L9.7 7"/></svg><span>Download for macOS, Windows &amp; Linux</span></a>`;
}
/**
 * In-app update control, rendered only inside the Electron app (the preload exposes
 * `window.desktop.updates`). Always visible there: it reports the installed version
 * while idle and the updater's progress otherwise.
 */
function updateNotice(): string {
  if (window.desktop?.updates === undefined) return "";
  return `<button type="button" class="update-notice" data-status="unchecked" aria-live="polite"><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.65M2.5 8a5.5 5.5 0 0 1 9.6-3.65"/><path d="M12.5 1.8v2.9h-2.9M3.5 14.2v-2.9h2.9"/></svg><span></span></button>`;
}
function installedVersion(): string {
  return window.desktop?.version ?? "0.0.0";
}
function updateLabel(state: DesktopUpdateState): {
  text: string;
  busy: boolean;
} {
  switch (state.status) {
    case "checking":
      return { text: "Checking for updates…", busy: true };
    case "available":
      return {
        text: `${state.canInstall ? "Update to" : "Download"} v${state.version}`,
        busy: false,
      };
    case "downloading":
      return { text: `Updating… ${state.percent}%`, busy: true };
    case "downloaded":
      return { text: "Restart to update", busy: false };
    case "error":
      return { text: "Update check failed · Retry", busy: false };
    case "unsupported":
      return { text: `v${installedVersion()} · Get updates`, busy: false };
    case "idle":
      return { text: `v${installedVersion()} · Up to date`, busy: false };
    default:
      return {
        text: `v${installedVersion()} · Check for updates`,
        busy: false,
      };
  }
}
function outline(track: Track, className: string): string {
  const xs = track.samples.map((s) => s.x),
    zs = track.samples.map((s) => s.z);
  const x = Math.min(...xs) - 20,
    z = Math.min(...zs) - 20;
  return `<svg class="${className}" viewBox="${x} ${z} ${Math.max(...xs) + 20 - x} ${Math.max(...zs) + 20 - z}" aria-hidden="true"><path d="${trackPath(track)}" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round"/></svg>`;
}
function replayPacer(entry: LeaderboardEntry): ArmedPacer {
  return {
    kind: "replay",
    name: entry.name,
    track: entry.track,
    difficulty: entry.difficulty,
    entry,
  };
}
const ARROWS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};
/** Index an arrow/Home/End key moves to from `index`; -1 for any other key. */
function step(key: string, index: number, length: number, wrap = true): number {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const delta = ARROWS[key];
  if (!delta) return -1;
  const next = index + delta;
  return wrap
    ? (next + length) % length
    : Math.max(0, Math.min(length - 1, next));
}

export class Lobby {
  private readonly root = document.createElement("div");
  private readonly randomRoll =
    CAR_VARIANTS[Math.floor(Math.random() * CAR_VARIANTS.length)];
  private choice: Choice;
  private track: TrackSlug = DEFAULT_TRACK_SLUG;
  private difficulty: Difficulty = DEFAULT_DIFFICULTY;
  // Records-panel browse filters. They follow the race selection whenever it
  // changes, but changing them never touches the race selection.
  private boardTrack: TrackSlug = DEFAULT_TRACK_SLUG;
  private boardDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  private entries: LeaderboardEntry[] = [];
  private eligible: LeaderboardEntry[] = [];
  private pacer: ArmedPacer | null = null;
  private updateState: DesktopUpdateState = { status: "unchecked" };
  private reference: ReferenceLap | null | undefined;
  private images = new Map<Variant, string>();
  private readonly nameInput: HTMLInputElement;
  private readonly picker: HTMLSelectElement;
  private screen: Screen = "garage";
  private setupTab: SetupTab = "race";
  private rooms: RoomInfo[] = [];
  /** Open room the player intends to join; null means "create a new room". */
  private roomChoice: string | null = null;
  private stage: GarageStage | null = null;
  private trackStage: TrackStage | null = null;
  private pointerStart: { x: number; y: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: LobbyCallbacks,
  ) {
    const saved = localStorage.getItem("racer-variant");
    this.choice = asVariant(saved) ?? "random";
    if (saved !== null && saved !== this.choice)
      localStorage.setItem("racer-variant", this.choice);
    const radio = (
      className: string,
      attrs: string,
      body: string,
      aria = "aria-checked",
    ): string =>
      `<button type="button" role="${aria === "aria-selected" ? "tab" : "radio"}" ${aria}="false" tabindex="-1" class="${className}" ${attrs}>${body}</button>`;
    this.root.className = "lobby-backdrop";
    this.root.innerHTML = `
      <main class="lobby">
        <header class="lobby-nav"><a class="brand" href="#" aria-label="Sunset Ridge home"><img class="brand-mark" src="${import.meta.env.BASE_URL}favicon.svg" alt="" width="40" height="40" /><span>SUNSET RIDGE</span></a><nav class="menu-progress" aria-label="Race setup progress"><button type="button" class="progress-car active" data-progress-screen="garage" aria-current="step" disabled>01 <b>GARAGE</b></button><i aria-hidden="true"></i><button type="button" class="progress-track" data-progress-screen="track" disabled>02 <b>CIRCUIT</b></button><i aria-hidden="true"></i><button type="button" class="progress-settings" data-progress-screen="settings" disabled>03 <b>RACE SETUP</b></button></nav><div class="lobby-nav-aside">${desktopNotice()}${updateNotice()}<span class="connection-status" role="status">CONNECTING</span></div></header>
        <div class="lobby-deck" data-screen="garage">
          <div class="live-car-stage" aria-hidden="true"></div>
          <section class="garage-screen menu-screen" aria-label="Choose your car">
            <div class="garage-heading"><h1>CHOOSE YOUR <span>CAR.</span></h1></div>
            <div class="car-stage" role="region" aria-roledescription="carousel" aria-label="Cars" tabindex="0">
              <div class="stage-sun"></div><div class="stage-horizon"></div><div class="stage-grid"></div><span class="stage-watermark" aria-hidden="true"></span><div class="stage-platform"></div>
              <div class="car-slides">${CHOICES.map((v) => `<div class="car-slide" data-slide="${v}" role="group" aria-roledescription="slide" aria-label="${label(v)}" aria-hidden="true"><img class="stage-car" alt="${v === "random" ? "Random car" : LABELS[v]}" draggable="false" hidden></div>`).join("")}</div>
              <div class="showroom-loading">Preparing your garage<span></span></div>
              <button class="carousel-arrow carousel-previous" type="button" data-carousel="previous" aria-label="Previous car"><span>←</span></button>
              <button class="carousel-arrow carousel-next" type="button" data-carousel="next" aria-label="Next car"><span>→</span></button>
            </div>
            <div class="garage-selection"><div class="selected-car-copy" aria-live="polite" aria-atomic="true"><span class="showroom-number"></span><div><h2 class="hero-car-name"></h2></div></div><button class="select-car primary-action" type="button" data-select-car aria-label="Select car">Select car <span>→</span></button></div>
            <div class="garage-navigation"><div class="garage" role="radiogroup" aria-label="Car models">${CHOICES.map((v, i) => radio(`garage-card${v === "random" ? " garage-card-random" : ""}`, `data-variant="${v}"`, `<span class="garage-card-number">${v === "random" ? "↝" : String(i + 1).padStart(2, "0")}</span><span class="garage-card-name">${label(v)}</span><span class="garage-card-line"></span>`)).join("")}</div></div>
          </section>
          <section class="track-screen menu-screen" aria-label="Choose your track" aria-hidden="true" inert>
            <div class="track-heading"><h1>CHOOSE YOUR <span>CIRCUIT.</span></h1><button class="menu-back" type="button" data-change-car aria-label="Change car">← Change car</button></div>
            <div class="track-stage" role="region" aria-roledescription="carousel" aria-label="Tracks" tabindex="0">
              <div class="stage-sun"></div><div class="stage-horizon"></div><div class="stage-grid"></div><div class="track-slides">${TRACKS.map((t) => `<div class="track-slide" data-track-slide="${t.id}" role="group" aria-roledescription="slide" aria-label="${html(t.name)}" aria-hidden="true">${outline(t, "track-hero-outline")}</div>`).join("")}</div><div class="live-track-stage"></div>
              <button class="carousel-arrow carousel-previous" type="button" data-track-carousel="previous" aria-label="Previous track">←</button><button class="carousel-arrow carousel-next" type="button" data-track-carousel="next" aria-label="Next track">→</button>
            </div>
            <div class="track-selection"><div class="selected-track-copy" aria-live="polite" aria-atomic="true"><span class="track-counter"></span><h2 class="hero-track-name"></h2></div><button class="select-track primary-action" type="button" data-select-track aria-label="Select track">Select track <span>→</span></button></div>
            <div class="track-selector" role="radiogroup" aria-label="Track">${TRACKS.map((t, i) => radio("track-card", `data-track="${t.id}"`, `<span class="track-number">0${i + 1}</span>${outline(t, "track-outline")}<span class="track-card-name">${html(t.name)}</span><span class="track-choice-line"></span>`)).join("")}</div>
          </section>
          <section class="settings-screen menu-screen" aria-label="Race settings" aria-hidden="true" inert>
            <div class="setup-scene" aria-hidden="true"><div class="setup-halo"></div><img class="setup-car-image" alt="" hidden><div class="setup-circuit-outline"></div></div>
            <div class="settings-inner"><div class="settings-heading"><h1>RACE <span>SETUP.</span></h1><div class="setup-selections"><button class="change-selection change-car" type="button" data-change-car aria-label="Change car"><img class="selected-car-thumb" alt="" hidden><span class="selected-car-name"></span><span class="change-label">Change car</span></button><button class="change-selection change-track" type="button" data-change-track aria-label="Change track"><span class="selected-track-name"></span><span class="change-label">Change track</span></button></div></div>
            <div class="setup-shell"><nav class="setup-menu" aria-label="Race menu" role="tablist">${SETUP_TABS.map((tab, i) => radio("setup-menu-item", `aria-controls="setup-${tab}-panel" id="setup-${tab}-tab" data-setup-tab="${tab}"`, `<span>0${i + 1}</span>${tab === "race" ? "Race" : "Records"}<span class="setup-menu-arrow">→</span>`, "aria-selected")).join("")}</nav>
            <div class="setup-workspace">
              <section class="setup-panel panel-rooms" role="tabpanel" id="setup-race-panel" aria-labelledby="setup-race-tab" data-setup-panel="race"><h2>YOUR RACE</h2><div class="name-row setup-field"><label for="driver-name">Driver</label><input id="driver-name" aria-label="Driver" maxlength="16" placeholder="Your name" autocomplete="off"></div><div class="diff-picker setup-field" role="radiogroup" aria-label="Difficulty"><span class="section-label">Difficulty</span><div class="diff-options">${DIFFICULTIES.map((d) => radio(`diff-opt diff-${d}`, `data-diff="${d}"`, DIFFICULTY_LABELS[d])).join("")}</div></div><label class="pacer-picker setup-field"><span class="pacer-picker-lead">Pacer</span><select class="pacer-select" aria-label="Pacer"></select></label><form class="create-form"><div class="setup-field room-field"><span class="section-label" id="room-field-label">Room<small class="room-total"></small></span><div class="room-list" role="radiogroup" aria-labelledby="room-field-label"></div></div><label class="setup-field room-name-field"><span>Room name</span><input maxlength="24" placeholder="New room name" aria-label="New room name"></label><button type="submit" class="primary-action"><span class="primary-action-label">Create &amp; Race</span> <span>→</span></button></form></section>
              <section class="setup-panel panel-laps" role="tabpanel" id="setup-records-panel" aria-labelledby="setup-records-tab" data-setup-panel="records" hidden><div class="panel-heading board-heading"><h2>RECORDS</h2><div class="board-controls"><div class="board-diff-picker" role="radiogroup" aria-label="Records difficulty">${DIFFICULTIES.map((d) => radio(`board-diff-opt diff-${d}`, `data-board-diff="${d}"`, DIFFICULTY_LABELS[d])).join("")}</div><div class="board-track-menu"><button type="button" class="board-track-select" aria-haspopup="listbox" aria-expanded="false" aria-label="Records track" data-board-track-toggle="1"><span class="board-track-label"></span><span class="board-track-chevron" aria-hidden="true"></span></button><div class="board-track-list" role="listbox" aria-label="Records track" hidden>${TRACKS.map((t, i) => `<button type="button" role="option" class="board-track-opt" aria-selected="false" data-board-track="${t.id}">${outline(t, "board-track-thumb")}<span class="board-track-opt-copy"><small>0${i + 1}</small>${html(t.name)}</span></button>`).join("")}</div></div></div></div><div class="board-note" aria-live="polite" hidden><span class="board-note-text"></span><button type="button" class="board-use-settings" data-board-use-settings="1">Use these settings</button></div><ol class="lb-list"></ol><div class="lb-empty" hidden><span class="empty-timer">--:--.---</span><span class="lb-empty-copy">No laps yet.</span></div><div class="lb-ai-record" hidden><button class="lb-ai-record-btn" data-ai-record="1">▶ Watch AI Record</button></div></section>
            </div></div></div>
          </section>
        </div>
      </main>`;
    parent.append(this.root);
    this.nameInput = this.find<HTMLInputElement>("#driver-name");
    this.picker = this.find<HTMLSelectElement>(".pacer-select");
    this.nameInput.value =
      localStorage.getItem("racer-name") ??
      `Racer${100 + Math.floor(Math.random() * 900)}`;
    this.nameInput.addEventListener("change", () => this.saveName());
    const form = this.find<HTMLFormElement>(".create-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveName();
      if (this.roomChoice) {
        callbacks.onJoin(this.roomChoice);
        return;
      }
      const input = this.find<HTMLInputElement>(".room-name-field input");
      callbacks.onCreate(
        input.value.trim() || `${this.playerName}'s race`,
        this.track,
        this.difficulty,
      );
      input.value = "";
    });
    form.addEventListener("change", ({ target }) => {
      if (target instanceof HTMLInputElement && target.name === "room-choice")
        this.chooseRoom(target.value || null);
    });
    this.root.addEventListener("click", (event) => this.click(event));
    this.root.addEventListener("keydown", (event) => this.keydown(event));
    this.picker.addEventListener("change", () => this.choosePacer());
    document.addEventListener("pointerdown", ({ target }) => {
      if (
        target instanceof Node &&
        !this.find(".board-track-menu").contains(target)
      )
        this.toggleBoardTrackMenu(false);
    });
    const stage = this.find(".track-stage");
    stage.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest("button"))
        return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
      stage.setPointerCapture?.(event.pointerId);
    });
    stage.addEventListener("pointerup", (event) => {
      if (!this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x,
        dy = event.clientY - this.pointerStart.y;
      this.pointerStart = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy))
        this.cycleTrack(dx < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", () => {
      this.pointerStart = null;
    });
    this.check(".garage-card", "variant", this.choice);
    this.check(".track-card", "track", this.track);
    this.check(".diff-opt", "diff", this.difficulty);
    this.check("[data-setup-tab]", "setupTab", this.setupTab, "aria-selected");
    this.paintHero();
    this.paintTrack();
    this.setRooms([]);
    this.renderBoard();
    this.bindUpdates();
  }
  /** Hook the desktop update bridge (no-op in the browser build). */
  private bindUpdates(): void {
    const updates = window.desktop?.updates;
    if (updates === undefined) return;
    this.find(".update-notice").addEventListener("click", () => {
      const { status } = this.updateState;
      if (
        status === "available" ||
        status === "downloaded" ||
        status === "unsupported"
      )
        void updates.install();
      else if (
        status === "unchecked" ||
        status === "idle" ||
        status === "error"
      )
        void updates.check();
    });
    updates.onState((state) => this.paintUpdate(state));
    this.paintUpdate(this.updateState);
    // Catch up: the main process may have finished its first check before this
    // renderer subscribed.
    void updates.getState().then((state) => this.paintUpdate(state));
  }
  private paintUpdate(state: DesktopUpdateState): void {
    this.updateState = state;
    const button = this.find<HTMLButtonElement>(".update-notice");
    const { text, busy } = updateLabel(state);
    button.disabled = busy;
    button.dataset.status = state.status;
    button.querySelector("span")!.textContent = text;
    button.setAttribute("aria-label", text);
    button.title = text;
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }
  /** Roving-tabindex radio/tab group: the node whose `data-<key>` equals `value` is checked. */
  private check(
    selector: string,
    key: string,
    value: string,
    aria = "aria-checked",
  ): void {
    for (const node of this.root.querySelectorAll<HTMLElement>(selector)) {
      const active = node.dataset[key] === value;
      node.classList.toggle("active", active);
      node.setAttribute(aria, String(active));
      node.tabIndex = active ? 0 : -1;
    }
  }
  private saveName(): void {
    localStorage.setItem("racer-name", this.playerName);
  }
  get playerName(): string {
    return this.nameInput.value.trim().slice(0, 16) || "Racer";
  }
  get selectedVariant(): Variant {
    return this.choice === "random" ? this.randomRoll : this.choice;
  }
  get armedPacer(): ArmedPacer | null {
    return this.pacer;
  }
  private click(event: MouseEvent): void {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button")
        : null;
    if (!button) return;
    const data = button.dataset;
    // Progress steps are disabled unless they lead somewhere, so a click is always valid.
    if (data.progressScreen) this.setScreen(data.progressScreen as Screen);
    else if (data.carousel) this.cycle(data.carousel === "next" ? 1 : -1);
    else if (data.variant) this.chooseCar(data.variant as Choice);
    else if (data.selectCar !== undefined || data.changeTrack !== undefined)
      this.setScreen("track");
    else if (data.changeCar !== undefined) this.setScreen("garage");
    else if (data.selectTrack !== undefined) this.setScreen("settings");
    else if (data.trackCarousel)
      this.cycleTrack(data.trackCarousel === "next" ? 1 : -1);
    else if (data.setupTab) this.setSetupTab(data.setupTab as SetupTab);
    else if (data.replay !== undefined)
      this.callbacks.onReplay(
        data.replay,
        data.track as TrackSlug,
        data.diff as Difficulty,
      );
    else if (data.boardDiff)
      this.chooseBoardDifficulty(data.boardDiff as Difficulty);
    else if (data.boardTrackToggle) this.toggleBoardTrackMenu();
    else if (data.boardTrack) {
      this.chooseBoardTrack(data.boardTrack);
      this.toggleBoardTrackMenu(false);
      this.find(".board-track-select").focus();
    } else if (data.boardUseSettings) this.useBoardSettings();
    else if (data.aiRecord) this.callbacks.onReferenceLap();
    else if (data.track) this.chooseTrack(data.track);
    else if (data.diff) this.chooseDifficulty(data.diff as Difficulty);
  }
  private chooseDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.boardDifficulty = difficulty;
    this.check(".diff-opt", "diff", difficulty);
    this.reconcileRoomChoice();
    this.renderBoard();
  }
  private chooseCar(choice: Choice): void {
    if (choice === this.choice) return;
    this.choice = choice;
    localStorage.setItem("racer-variant", choice);
    this.check(".garage-card", "variant", choice);
    this.paintHero();
    this.callbacks.onVariantChange();
  }
  private cycle(direction: number): void {
    const index = CHOICES.indexOf(this.choice);
    this.chooseCar(
      CHOICES[(index + direction + CHOICES.length) % CHOICES.length],
    );
  }
  private chooseTrack(track: TrackSlug, direction = 1): void {
    if (track === this.track) return;
    this.track = track;
    this.boardTrack = track;
    this.check(".track-card", "track", track);
    this.paintTrack(direction);
    this.reconcileRoomChoice();
    this.renderBoard();
  }
  private cycleTrack(direction: number): void {
    const index = TRACK_IDS.indexOf(this.track);
    this.chooseTrack(
      TRACK_IDS[(index + direction + TRACK_IDS.length) % TRACK_IDS.length],
      direction,
    );
  }
  private chooseBoardDifficulty(difficulty: Difficulty): void {
    this.boardDifficulty = difficulty;
    this.paintBoard();
  }
  private chooseBoardTrack(track: TrackSlug): void {
    this.boardTrack = track;
    this.paintBoard();
  }
  private boardTrackMenuOpen(): boolean {
    return !this.find(".board-track-list").hidden;
  }
  private toggleBoardTrackMenu(open = !this.boardTrackMenuOpen()): void {
    this.find(".board-track-list").hidden = !open;
    this.find(".board-track-select").setAttribute(
      "aria-expanded",
      String(open),
    );
    if (open)
      this.find(
        `.board-track-opt[data-board-track="${this.boardTrack}"]`,
      ).focus();
  }
  /** Copy the Records browse filters into the race selection. */
  private useBoardSettings(): void {
    const { boardTrack, boardDifficulty } = this;
    this.chooseTrack(boardTrack);
    this.chooseDifficulty(boardDifficulty);
    // Syncing hides the note that holds the "Use these settings" button, so
    // hand keyboard focus to the checked difficulty radio instead of <body>.
    this.find(`.board-diff-opt[data-board-diff="${boardDifficulty}"]`).focus();
  }
  /** Keyboard support for the Records track listbox. True when consumed. */
  private boardTrackMenu(event: KeyboardEvent, target: Element): boolean {
    const open = this.boardTrackMenuOpen();
    if (event.key === "Escape" && open) {
      this.toggleBoardTrackMenu(false);
      this.find(".board-track-select").focus();
      return true;
    }
    if (
      target.closest(".board-track-select") &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      this.toggleBoardTrackMenu(true);
      return true;
    }
    if (!open) return false;
    const options = [
      ...this.root.querySelectorAll<HTMLButtonElement>(".board-track-opt"),
    ];
    const next = step(
      event.key,
      options.indexOf(document.activeElement as HTMLButtonElement),
      options.length,
      false,
    );
    if (next === -1) return event.key === "Enter" || event.key === " ";
    options[next].focus();
    return true;
  }
  private paintTrack(direction = 1): void {
    const track = resolveTrack(this.track);
    this.find(".hero-track-name").textContent = track.name;
    this.find(".selected-track-name").textContent = track.name;
    this.find(".track-counter").textContent =
      `${String(TRACK_IDS.indexOf(this.track) + 1).padStart(2, "0")} / ${String(TRACKS.length).padStart(2, "0")}`;
    this.find(".setup-circuit-outline").innerHTML = outline(
      track,
      "setup-track-outline",
    );
    for (const slide of this.root.querySelectorAll<HTMLElement>(
      ".track-slide",
    )) {
      const active = slide.dataset.trackSlide === this.track;
      slide.classList.toggle("active", active);
      slide.setAttribute("aria-hidden", String(!active));
    }
    this.trackStage?.setTrack(this.track, direction);
  }
  private keydown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(".board-track-menu") &&
      this.boardTrackMenu(event, target)
    )
      return;
    if (event.key === "Escape" && this.screen !== "garage") {
      event.preventDefault();
      this.setScreen(this.screen === "settings" ? "track" : "garage");
      return;
    }
    if (target?.closest("input, select, textarea")) return;
    if (this.screen === "settings") {
      if (target?.closest(".board-diff-picker")) {
        const next = step(
          event.key,
          DIFFICULTIES.indexOf(this.boardDifficulty),
          DIFFICULTIES.length,
        );
        if (next === -1) return;
        event.preventDefault();
        this.chooseBoardDifficulty(DIFFICULTIES[next]);
        this.find(
          `.board-diff-opt[data-board-diff="${DIFFICULTIES[next]}"]`,
        ).focus();
      } else if (target?.closest(".diff-picker")) {
        const next = step(
          event.key,
          DIFFICULTIES.indexOf(this.difficulty),
          DIFFICULTIES.length,
        );
        if (next === -1) return;
        event.preventDefault();
        this.chooseDifficulty(DIFFICULTIES[next]);
        this.find(`.diff-opt[data-diff="${DIFFICULTIES[next]}"]`).focus();
      } else if (target?.closest(".setup-menu")) {
        const next = step(
          event.key,
          SETUP_TABS.indexOf(this.setupTab),
          SETUP_TABS.length,
        );
        if (next === -1) return;
        event.preventDefault();
        this.setSetupTab(SETUP_TABS[next]);
      }
      return;
    }
    // Carousels only answer to horizontal arrows.
    if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
    if (this.screen === "track") {
      const next = step(
        event.key,
        TRACK_IDS.indexOf(this.track),
        TRACK_IDS.length,
      );
      if (next === -1) return;
      event.preventDefault();
      this.chooseTrack(TRACK_IDS[next], event.key === "ArrowLeft" ? -1 : 1);
      if (target?.closest(".track-selector"))
        this.find(`.track-card[data-track="${this.track}"]`).focus();
    } else {
      const next = step(
        event.key,
        CHOICES.indexOf(this.choice),
        CHOICES.length,
      );
      if (next === -1) return;
      event.preventDefault();
      this.chooseCar(CHOICES[next]);
      if (target?.closest(".garage"))
        this.find(`.garage-card[data-variant="${this.choice}"]`).focus();
    }
  }
  private setScreen(screen: Screen): void {
    this.screen = screen;
    this.stage?.setScreen(screen);
    this.trackStage?.setActive(screen === "track");
    this.find(".lobby-deck").dataset.screen = screen;
    for (const page of ["garage", "track", "settings"] as const) {
      const section = this.find(`.${page}-screen`);
      section.toggleAttribute("inert", page !== screen);
      section.setAttribute("aria-hidden", String(page !== screen));
      const stepButton = this.find<HTMLButtonElement>(
        `[data-progress-screen="${page}"]`,
      );
      stepButton.classList.toggle("active", page === screen);
      stepButton.disabled =
        page === screen || page === "settings" || screen === "garage";
      if (page === screen) stepButton.setAttribute("aria-current", "step");
      else stepButton.removeAttribute("aria-current");
    }
    this.find(
      screen === "settings"
        ? `[data-setup-tab="${this.setupTab}"]`
        : screen === "track"
          ? "[data-select-track]"
          : "[data-select-car]",
    ).focus({ preventScroll: true });
  }
  private setSetupTab(tab: SetupTab): void {
    this.setupTab = tab;
    this.check("[data-setup-tab]", "setupTab", tab, "aria-selected");
    for (const panel of this.root.querySelectorAll<HTMLElement>(
      "[data-setup-panel]",
    ))
      panel.hidden = panel.dataset.setupPanel !== tab;
    this.find(`[data-setup-tab="${tab}"]`).focus({ preventScroll: true });
  }
  setConnection(state: ConnectionState): void {
    const badge = this.find(".connection-status");
    badge.textContent =
      state === "connected" ? "LIVE MULTIPLAYER" : state.toUpperCase();
    badge.dataset.state = state;
  }
  paintGarageThumbnails(): boolean {
    this.images = renderVariantThumbnails(CAR_VARIANTS);
    for (const choice of CHOICES) {
      const url = this.images.get(
        choice === "random" ? this.randomRoll : choice,
      );
      if (!url) continue;
      const img = this.find<HTMLImageElement>(`[data-slide="${choice}"] img`);
      img.src = url;
      img.hidden = false;
    }
    this.find(".showroom-loading").hidden = true;
    const shown = this.root.style.display !== "none";
    if (!this.stage) {
      try {
        this.stage = new GarageStage(
          this.find(".live-car-stage"),
          this.find(".car-stage"),
        );
        this.stage.setActive(shown);
        this.stage.setScreen(this.screen);
      } catch {
        // The still previews also work when a second WebGL context is unavailable.
      }
    }
    if (!this.trackStage) {
      try {
        this.trackStage = new TrackStage(this.find(".live-track-stage"));
        this.trackStage.setActive(shown && this.screen === "track");
      } catch {
        // Exact circuit outlines remain available without WebGL.
      }
    }
    this.paintTrack();
    this.paintHero();
    return this.stage !== null;
  }
  private paintHero(): void {
    const index = CHOICES.indexOf(this.choice);
    const name = label(this.choice);
    this.find(".hero-car-name").textContent = name;
    this.find(".selected-car-name").textContent =
      this.choice === "random"
        ? `Random · ${LABELS[this.selectedVariant]}`
        : name;
    this.find(".stage-watermark").textContent = name;
    this.find(".showroom-number").textContent =
      `${this.choice === "random" ? "↝" : String(index + 1).padStart(2, "0")} / ${CAR_COUNT}`;
    this.stage?.setVariant(this.selectedVariant);
    this.root
      .querySelectorAll<HTMLElement>(".car-slide")
      .forEach((slide, i) => {
        let offset = (i - index + CHOICES.length) % CHOICES.length;
        if (offset > CHOICES.length / 2) offset -= CHOICES.length;
        slide.dataset.position =
          offset === 0
            ? "current"
            : offset === -1
              ? "previous"
              : offset === 1
                ? "next"
                : "offstage";
        slide.setAttribute("aria-hidden", String(offset !== 0));
      });
    const url = this.images.get(this.selectedVariant);
    if (!url) return;
    for (const selector of [".selected-car-thumb", ".setup-car-image"]) {
      const img = this.find<HTMLImageElement>(selector);
      img.src = url;
      img.hidden = false;
    }
  }
  setRooms(rooms: RoomInfo[]): void {
    this.rooms = rooms;
    this.find(".room-total").textContent = rooms.length
      ? `${rooms.length} OPEN ${rooms.length === 1 ? "ROOM" : "ROOMS"}`
      : "NO OPEN ROOMS";
    const row = (value: string, body: string): string =>
      `<label class="room-row"><input type="radio" name="room-choice" value="${html(value)}">${body}</label>`;
    this.find(".room-list").innerHTML =
      row(
        "",
        '<span class="room-name">New room<small class="room-track-name">Open a room with the settings above</small></span>',
      ) +
      rooms
        .map((room) => {
          const track = resolveTrack(room.track);
          return row(
            room.id,
            `${outline(track, "room-track-thumb")}<span class="room-name">${html(room.name)}<small class="room-track-name">${html(track.name)}</small></span><span class="room-badge diff-${room.difficulty}">${DIFFICULTY_LABELS[room.difficulty]}</span><span class="room-count">${room.players} racing</span>`,
          );
        })
        .join("");
    this.reconcileRoomChoice();
  }
  /** Pick an open room to join (its track and difficulty apply) or null for a new room. */
  private chooseRoom(id: string | null): void {
    const room = this.rooms.find((r) => r.id === id) ?? null;
    // Sync settings first: each setter reconciles, and the room only survives
    // reconciliation once both track and difficulty match.
    this.roomChoice = null;
    if (room) {
      this.chooseTrack(room.track);
      this.chooseDifficulty(room.difficulty);
    }
    this.roomChoice = room?.id ?? null;
    this.syncRoomChoice();
  }
  /**
   * A chosen room only stays chosen while it is still open and the race
   * settings still match it; otherwise fall back to creating a new room.
   */
  private reconcileRoomChoice(): void {
    const room = this.rooms.find((r) => r.id === this.roomChoice);
    if (
      !room ||
      room.track !== this.track ||
      room.difficulty !== this.difficulty
    )
      this.roomChoice = null;
    this.syncRoomChoice();
  }
  private syncRoomChoice(): void {
    const choice = this.roomChoice ?? "";
    for (const radio of this.root.querySelectorAll<HTMLInputElement>(
      'input[name="room-choice"]',
    )) {
      radio.checked = radio.value === choice;
      radio.closest(".room-row")?.classList.toggle("active", radio.checked);
    }
    this.find(".room-name-field").hidden = this.roomChoice !== null;
    this.find(".primary-action-label").textContent = this.roomChoice
      ? "Join & Race"
      : "Create & Race";
  }
  setLeaderboard(entries: LeaderboardEntry[]): void {
    this.entries = entries;
    this.renderBoard();
  }
  getReferenceLap(): ReferenceLap | null {
    if (this.reference === undefined)
      this.reference = buildReferenceLap(policy);
    return this.reference;
  }
  /** The AI reference lap exists only for Sunset Ridge at Medium. */
  private aiEligible(): boolean {
    return this.track === "sunset-ridge" && this.difficulty === "medium";
  }
  private renderBoard(): void {
    this.reconcilePacer();
    this.paintBoard();
  }
  /**
   * Pacer eligibility is about the RACE the player is setting up, so it keys
   * off this.track / this.difficulty regardless of what the Records panel is
   * browsing.
   */
  private reconcilePacer(): void {
    this.eligible = this.entries.filter(
      (e) =>
        e.hasReplay &&
        e.track === this.track &&
        e.difficulty === this.difficulty,
    );
    const pacer = this.pacer;
    if (pacer?.kind === "ai") {
      if (!this.aiEligible()) this.pacer = null;
    } else if (pacer) {
      const entry = this.eligible.find(
        (e) =>
          e.name === pacer.name &&
          e.track === pacer.track &&
          e.difficulty === pacer.difficulty,
      );
      this.pacer = entry ? replayPacer(entry) : null;
    }
    const ai = this.aiEligible() ? this.getReferenceLap() : null;
    const choices = this.eligible.map((e, i) => ({
      time: e.timeMs,
      value: String(i),
      name: e.name,
    }));
    if (ai) choices.push({ time: ai.timeMs, value: "ai", name: "AI Record" });
    choices.sort((a, b) => a.time - b.time);
    this.picker.innerHTML =
      '<option value="-1">No Pacer — race alone</option>' +
      choices
        .map(
          (c) =>
            `<option value="${c.value}"${c.value === "ai" ? ' class="pacer-opt-ai"' : ""}>⚑ ${html(c.name)} — ${formatMs(c.time)}</option>`,
        )
        .join("");
    this.picker.disabled = choices.length === 0;
    const armed = this.pacer;
    this.picker.value =
      armed?.kind === "ai"
        ? "ai"
        : armed
          ? String(this.eligible.findIndex((e) => e.name === armed.name))
          : "-1";
  }
  /** The visible Records list follows the board filters, not the race setup. */
  private paintBoard(): void {
    const { boardTrack, boardDifficulty } = this;
    const entries = this.entries.filter(
      (e) => e.track === boardTrack && e.difficulty === boardDifficulty,
    );
    this.check(".board-diff-opt", "boardDiff", boardDifficulty);
    this.find(".board-track-label").textContent = resolveTrack(boardTrack).name;
    for (const option of this.root.querySelectorAll<HTMLElement>(
      ".board-track-opt",
    )) {
      const active = option.dataset.boardTrack === boardTrack;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    }
    this.find(".board-note-text").textContent =
      `Browsing only. Your race is still ${resolveTrack(this.track).name}, ${DIFFICULTY_LABELS[this.difficulty]}.`;
    this.find(".board-note").hidden =
      boardTrack === this.track && boardDifficulty === this.difficulty;
    this.find(".lb-empty-copy").textContent =
      `No laps yet on ${resolveTrack(boardTrack).name}, ${DIFFICULTY_LABELS[boardDifficulty]}.`;
    this.find(".lb-empty").hidden = entries.length > 0;
    this.find(".lb-list").innerHTML = entries
      .map(
        (e) =>
          `<li><span class="lb-name">${html(e.name)}</span><span class="lb-time">${formatMs(e.timeMs)}</span>${e.hasReplay ? `<button class="lb-replay" data-replay="${html(e.name)}" data-track="${e.track}" data-diff="${e.difficulty}" title="Watch replay" aria-label="Watch ${html(e.name)} replay">▶</button>` : ""}</li>`,
      )
      .join("");
    // The AI Record button plays the Sunset Ridge / Medium reference lap, so
    // it belongs to whatever the board is browsing, not to the race setup.
    this.find(".lb-ai-record").hidden = !(
      boardTrack === "sunset-ridge" && boardDifficulty === "medium"
    );
  }
  private choosePacer(): void {
    if (this.picker.value === "ai") {
      const lap = this.getReferenceLap();
      this.pacer =
        lap && this.aiEligible()
          ? {
              kind: "ai",
              name: "AI Record",
              track: this.track,
              difficulty: "medium",
              variant: "police",
              frames: lap.frames,
            }
          : null;
    } else {
      const entry = this.eligible[Number(this.picker.value)];
      this.pacer = entry ? replayPacer(entry) : null;
    }
  }
  show(): void {
    this.root.style.display = "";
    this.stage?.setActive(true);
    this.trackStage?.setActive(this.screen === "track");
  }
  hide(): void {
    this.root.style.display = "none";
    this.stage?.setActive(false);
    this.trackStage?.setActive(false);
  }
}
