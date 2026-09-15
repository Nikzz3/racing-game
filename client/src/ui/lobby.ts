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
/** GitHub releases page where the desktop installers (`desktop-v*` tags) are published. */
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/Nikzz3/racing-game/releases";
/**
 * Link to the desktop installers, shown only in the browser build: inside the Electron
 * app `window.desktop` is present and the notice would be noise.
 */
function desktopNotice(): string {
  if (window.desktop !== undefined) return "";
  return `<a class="desktop-notice" href="${DESKTOP_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer" aria-label="Download the desktop app for macOS, Windows and Linux"><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M5.5 14h5M8 11v3M8 4.5v4M6.3 7l1.7 1.7L9.7 7"/></svg><span>Download for macOS, Windows &amp; Linux</span></a>`;
}
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
function outline(track: Track, className: string): string {
  const xs = track.samples.map((s) => s.x),
    zs = track.samples.map((s) => s.z);
  const box = [
    Math.min(...xs) - 20,
    Math.min(...zs) - 20,
    Math.max(...xs) - Math.min(...xs) + 40,
    Math.max(...zs) - Math.min(...zs) + 40,
  ];
  return `<svg class="${className}" viewBox="${box.join(" ")}" aria-hidden="true"><path d="${trackPath(track)}" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round"/></svg>`;
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
export class Lobby {
  private readonly root = document.createElement("div");
  private readonly randomRoll =
    CAR_VARIANTS[Math.floor(Math.random() * CAR_VARIANTS.length)];
  private choice: Choice;
  private track = DEFAULT_TRACK_SLUG;
  private difficulty: Difficulty = DEFAULT_DIFFICULTY;
  // Records-panel browse filters. They follow the race selection whenever it
  // changes, but changing them never touches the race selection.
  private boardTrack: TrackSlug = DEFAULT_TRACK_SLUG;
  private boardDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  private entries: LeaderboardEntry[] = [];
  private eligible: LeaderboardEntry[] = [];
  private pacer: ArmedPacer | null = null;
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
  private slideDirection = 1;
  private pointerStart: { x: number; y: number } | null = null;
  constructor(
    parent: HTMLElement,
    private readonly callbacks: LobbyCallbacks,
  ) {
    const saved = localStorage.getItem("racer-variant");
    this.choice = asVariant(saved) ?? "random";
    if (saved !== null && saved !== this.choice)
      localStorage.setItem("racer-variant", this.choice);
    this.root.className = "lobby-backdrop";
    this.root.innerHTML = `
      <main class="lobby">
        <header class="lobby-nav"><a class="brand" href="#" aria-label="Sunset Ridge home"><img class="brand-mark" src="${import.meta.env.BASE_URL}favicon.svg" alt="" width="40" height="40" /><span>SUNSET RIDGE</span></a><nav class="menu-progress" aria-label="Race setup progress"><button type="button" class="progress-car active" data-progress-screen="garage" aria-current="step" disabled>01 <b>GARAGE</b></button><i aria-hidden="true"></i><button type="button" class="progress-track" data-progress-screen="track" disabled>02 <b>CIRCUIT</b></button><i aria-hidden="true"></i><button type="button" class="progress-settings" data-progress-screen="settings" disabled>03 <b>RACE SETUP</b></button></nav><div class="lobby-nav-aside">${desktopNotice()}<span class="connection-status" role="status">CONNECTING</span></div></header>
        <div class="lobby-deck" data-screen="garage">
          <section class="garage-screen menu-screen" aria-label="Choose your car">
            <div class="garage-heading"><h1>CHOOSE YOUR <span>CAR.</span></h1></div>
            <div class="car-stage" role="region" aria-roledescription="carousel" aria-label="Cars" tabindex="0">
              <div class="stage-sun"></div><div class="stage-horizon"></div><div class="stage-grid"></div><span class="stage-watermark" aria-hidden="true"></span><div class="stage-platform"></div>
              <div class="car-slides">${CHOICES.map((v) => `<div class="car-slide" data-slide="${v}" role="group" aria-roledescription="slide" aria-label="${v === "random" ? "Random" : LABELS[v]}" aria-hidden="true"><img class="stage-car" alt="${v === "random" ? "Random car" : LABELS[v]}" draggable="false" hidden></div>`).join("")}</div>
              <div class="live-car-stage"></div><div class="showroom-loading">Preparing your garage<span></span></div>
              <button class="carousel-arrow carousel-previous" type="button" data-carousel="previous" aria-label="Previous car"><span>←</span></button>
              <button class="carousel-arrow carousel-next" type="button" data-carousel="next" aria-label="Next car"><span>→</span></button>
            </div>
            <div class="garage-selection"><div class="selected-car-copy" aria-live="polite" aria-atomic="true"><span class="showroom-number"></span><div><h2 class="hero-car-name"></h2></div></div><button class="select-car primary-action" type="button" data-select-car aria-label="Select car">Select car <span>→</span></button></div>
            <div class="garage-navigation"><div class="garage" role="radiogroup" aria-label="Car models">${CHOICES.map((v, i) => `<button type="button" role="radio" aria-checked="${v === this.choice}" tabindex="${v === this.choice ? 0 : -1}" class="garage-card${v === "random" ? " garage-card-random" : ""}${v === this.choice ? " active" : ""}" data-variant="${v}"><span class="garage-card-number">${v === "random" ? "↝" : String(i + 1).padStart(2, "0")}</span><span class="garage-card-name">${v === "random" ? "Random" : LABELS[v]}</span><span class="garage-card-line"></span></button>`).join("")}</div></div>
          </section>
          <section class="track-screen menu-screen" aria-label="Choose your track" aria-hidden="true" inert>
            <div class="track-heading"><h1>CHOOSE YOUR <span>CIRCUIT.</span></h1><button class="menu-back" type="button" data-change-car aria-label="Change car">← Change car</button></div>
            <div class="track-stage" role="region" aria-roledescription="carousel" aria-label="Tracks" tabindex="0">
              <div class="stage-sun"></div><div class="stage-horizon"></div><div class="stage-grid"></div><div class="track-slides">${TRACKS.map((t) => `<div class="track-slide" data-track-slide="${t.id}" role="group" aria-roledescription="slide" aria-label="${html(t.name)}" aria-hidden="true">${outline(t, "track-hero-outline")}</div>`).join("")}</div><div class="live-track-stage"></div>
              <button class="carousel-arrow carousel-previous" type="button" data-track-carousel="previous" aria-label="Previous track">←</button><button class="carousel-arrow carousel-next" type="button" data-track-carousel="next" aria-label="Next track">→</button>
            </div>
            <div class="track-selection"><div class="selected-track-copy" aria-live="polite" aria-atomic="true"><span class="track-counter"></span><h2 class="hero-track-name"></h2></div><button class="select-track primary-action" type="button" data-select-track aria-label="Select track">Select track <span>→</span></button></div>
            <div class="track-selector" role="radiogroup" aria-label="Track">${TRACKS.map((t, i) => `<button class="track-card${t.id === this.track ? " active" : ""}" type="button" role="radio" aria-checked="${t.id === this.track}" tabindex="${t.id === this.track ? 0 : -1}" data-track="${t.id}"><span class="track-number">0${i + 1}</span>${outline(t, "track-outline")}<span class="track-card-name">${html(t.name)}</span><span class="track-choice-line"></span></button>`).join("")}</div>
          </section>
          <section class="settings-screen menu-screen" aria-label="Race settings" aria-hidden="true" inert>
            <div class="setup-scene" aria-hidden="true"><div class="setup-halo"></div><img class="setup-car-image" alt="" hidden><div class="setup-circuit-outline"></div></div>
            <div class="settings-inner"><div class="settings-heading"><h1>RACE <span>SETUP.</span></h1><div class="setup-selections"><button class="change-selection change-car" type="button" data-change-car aria-label="Change car"><img class="selected-car-thumb" alt="" hidden><span class="selected-car-name"></span><span class="change-label">Change car</span></button><button class="change-selection change-track" type="button" data-change-track aria-label="Change track"><span class="selected-track-name"></span><span class="change-label">Change track</span></button></div></div>
            <div class="setup-shell"><nav class="setup-menu" aria-label="Race menu" role="tablist"><button type="button" role="tab" aria-selected="true" aria-controls="setup-race-panel" id="setup-race-tab" data-setup-tab="race" class="setup-menu-item active"><span>01</span>Race<span class="setup-menu-arrow">→</span></button><button type="button" role="tab" aria-selected="false" aria-controls="setup-records-panel" id="setup-records-tab" data-setup-tab="records" class="setup-menu-item" tabindex="-1"><span>02</span>Records<span class="setup-menu-arrow">→</span></button></nav>
            <div class="setup-workspace">
              <section class="setup-panel panel-rooms" role="tabpanel" id="setup-race-panel" aria-labelledby="setup-race-tab" data-setup-panel="race"><h2>YOUR RACE</h2><div class="name-row setup-field"><label for="driver-name">Driver</label><input id="driver-name" aria-label="Driver" maxlength="16" placeholder="Your name" autocomplete="off"></div><div class="diff-picker setup-field" role="radiogroup" aria-label="Difficulty"><span class="section-label">Difficulty</span><div class="diff-options">${DIFFICULTIES.map((d) => `<button type="button" role="radio" aria-checked="${d === this.difficulty}" class="diff-opt diff-${d}${d === this.difficulty ? " active" : ""}" tabindex="${d === this.difficulty ? 0 : -1}" data-diff="${d}">${DIFFICULTY_LABELS[d]}</button>`).join("")}</div></div><label class="pacer-picker setup-field"><span class="pacer-picker-lead">Pacer</span><select class="pacer-select" aria-label="Pacer"></select></label><form class="create-form"><div class="setup-field room-field"><span class="section-label" id="room-field-label">Room<small class="room-total"></small></span><div class="room-list" role="radiogroup" aria-labelledby="room-field-label"></div></div><label class="setup-field room-name-field"><span>Room name</span><input maxlength="24" placeholder="New room name" aria-label="New room name"></label><button type="submit" class="primary-action"><span class="primary-action-label">Create &amp; Race</span> <span>→</span></button></form></section>
              <section class="setup-panel panel-laps" role="tabpanel" id="setup-records-panel" aria-labelledby="setup-records-tab" data-setup-panel="records" hidden><div class="panel-heading board-heading"><h2>RECORDS</h2><div class="board-controls"><div class="board-diff-picker" role="radiogroup" aria-label="Records difficulty">${DIFFICULTIES.map((d) => `<button type="button" role="radio" aria-checked="${d === this.boardDifficulty}" class="board-diff-opt diff-${d}${d === this.boardDifficulty ? " active" : ""}" tabindex="${d === this.boardDifficulty ? 0 : -1}" data-board-diff="${d}">${DIFFICULTY_LABELS[d]}</button>`).join("")}</div><div class="board-track-menu"><button type="button" class="board-track-select" aria-haspopup="listbox" aria-expanded="false" aria-label="Records track" data-board-track-toggle="1"><span class="board-track-label"></span><span class="board-track-chevron" aria-hidden="true"></span></button><div class="board-track-list" role="listbox" aria-label="Records track" hidden>${TRACKS.map((t, i) => `<button type="button" role="option" class="board-track-opt" aria-selected="${t.id === this.boardTrack}" data-board-track="${html(t.id)}">${outline(t, "board-track-thumb")}<span class="board-track-opt-copy"><small>0${i + 1}</small>${html(t.name)}</span></button>`).join("")}</div></div></div></div><div class="board-note" aria-live="polite" hidden><span class="board-note-text"></span><button type="button" class="board-use-settings" data-board-use-settings="1">Use these settings</button></div><ol class="lb-list"></ol><div class="lb-empty" hidden><span class="empty-timer">--:--.---</span><span class="lb-empty-copy">No laps yet.</span></div><div class="lb-ai-record" hidden><button class="lb-ai-record-btn" data-ai-record="1">▶ Watch AI Record</button></div></section>
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
    this.find<HTMLFormElement>(".create-form").addEventListener(
      "submit",
      (event) => {
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
      },
    );
    this.find(".create-form").addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.name === "room-choice")
        this.chooseRoom(target.value || null);
    });
    this.root.addEventListener("click", (event) => this.click(event));
    this.picker.addEventListener("change", () => this.choosePacer());
    document.addEventListener("pointerdown", (event) => {
      if (
        event.target instanceof Node &&
        !this.find(".board-track-menu").contains(event.target)
      )
        this.toggleBoardTrackMenu(false);
    });
    this.root.addEventListener("keydown", (event) => this.keydown(event));
    for (const selector of [".track-stage"]) {
      const stage = this.find(selector);
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
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          this.cycleTrack(dx < 0 ? 1 : -1);
        }
      });
      stage.addEventListener("pointercancel", () => {
        this.pointerStart = null;
      });
    }
    this.paintHero();
    this.paintTrack();
    this.setRooms([]);
    this.renderBoard();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
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
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button) return;
    const data = button.dataset;
    if (data.progressScreen) {
      const destination = data.progressScreen;
      if (
        (destination === "garage" && this.screen !== "garage") ||
        (destination === "track" && this.screen === "settings")
      )
        this.setScreen(destination);
      return;
    }
    if (data.carousel) {
      this.cycle(data.carousel === "next" ? 1 : -1);
      return;
    }
    if (data.variant) {
      this.chooseCar(data.variant as Choice);
      return;
    }
    if (data.selectCar !== undefined) {
      this.setScreen("track");
      return;
    }
    if (data.changeCar !== undefined) {
      this.setScreen("garage");
      return;
    }
    if (data.changeTrack !== undefined) {
      this.setScreen("track");
      return;
    }
    if (data.selectTrack !== undefined) {
      this.setScreen("settings");
      return;
    }
    if (data.trackCarousel) {
      this.cycleTrack(data.trackCarousel === "next" ? 1 : -1);
      return;
    }
    if (data.setupTab) {
      this.setSetupTab(data.setupTab as SetupTab);
      return;
    }
    if (data.replay !== undefined) {
      this.callbacks.onReplay(
        data.replay,
        data.track!,
        data.diff as Difficulty,
      );
      return;
    }
    if (data.boardDiff) {
      this.chooseBoardDifficulty(data.boardDiff as Difficulty);
      return;
    }
    if (data.boardTrackToggle) {
      this.toggleBoardTrackMenu();
      return;
    }
    if (data.boardTrack) {
      this.chooseBoardTrack(data.boardTrack);
      this.toggleBoardTrackMenu(false);
      this.find(".board-track-select").focus();
      return;
    }
    if (data.boardUseSettings) {
      this.useBoardSettings();
      return;
    }
    if (data.aiRecord) {
      this.callbacks.onReferenceLap();
      return;
    } else if (data.track) this.chooseTrack(data.track);
    else if (data.diff) {
      this.chooseDifficulty(data.diff as Difficulty);
    }
  }
  private chooseDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.boardDifficulty = difficulty;
    this.mark(".diff-opt", this.find(`.diff-opt[data-diff="${difficulty}"]`));
    this.root.querySelectorAll<HTMLElement>(".diff-opt").forEach((button) => {
      button.tabIndex = button.dataset.diff === difficulty ? 0 : -1;
    });
    this.reconcileRoomChoice();
    this.renderBoard();
  }
  private chooseCar(choice: Choice): void {
    if (choice === this.choice) return;
    const previous = CHOICES.indexOf(this.choice),
      next = CHOICES.indexOf(choice);
    const distance = (next - previous + CHOICES.length) % CHOICES.length;
    this.slideDirection = distance <= CHOICES.length / 2 ? 1 : -1;
    this.choice = choice;
    localStorage.setItem("racer-variant", choice);
    this.root.querySelectorAll<HTMLElement>(".garage-card").forEach((card) => {
      const selected = card.dataset.variant === choice;
      card.classList.toggle("active", selected);
      card.setAttribute("aria-checked", String(selected));
      card.tabIndex = selected ? 0 : -1;
    });
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
    this.mark(".track-card", this.find(`.track-card[data-track="${track}"]`));
    this.root.querySelectorAll<HTMLElement>(".track-card").forEach((card) => {
      card.tabIndex = card.dataset.track === track ? 0 : -1;
    });
    this.paintTrack(direction);
    this.reconcileRoomChoice();
    this.renderBoard();
  }
  private cycleTrack(direction: number): void {
    const index = TRACKS.findIndex((t) => t.id === this.track);
    this.chooseTrack(
      TRACKS[(index + direction + TRACKS.length) % TRACKS.length].id,
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
      this.find<HTMLButtonElement>(
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
    this.root
      .querySelector<HTMLButtonElement>('.board-diff-opt[aria-checked="true"]')
      ?.focus();
  }
  /** Keyboard support for the Records track listbox. True when consumed. */
  private boardTrackMenu(event: KeyboardEvent): boolean {
    const open = this.boardTrackMenuOpen();
    if (event.key === "Escape" && open) {
      this.toggleBoardTrackMenu(false);
      this.find(".board-track-select").focus();
      return true;
    }
    const inTrigger =
      event.target instanceof Element &&
      event.target.closest(".board-track-select") !== null;
    if (inTrigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      this.toggleBoardTrackMenu(true);
      return true;
    }
    if (!open) return false;
    const options = [
      ...this.root.querySelectorAll<HTMLButtonElement>(".board-track-opt"),
    ];
    const index = options.findIndex((o) => o === document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, options.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : -1;
    if (next === -1) return event.key === "Enter" || event.key === " ";
    options[next].focus();
    return true;
  }
  private paintTrack(direction = 1): void {
    const track = resolveTrack(this.track);
    this.find(".hero-track-name").textContent = track.name;
    this.find(".selected-track-name").textContent = track.name;
    this.find(".track-counter").textContent =
      `${String(TRACKS.findIndex((t) => t.id === this.track) + 1).padStart(2, "0")} / ${String(TRACKS.length).padStart(2, "0")}`;
    this.find(".setup-circuit-outline").innerHTML = outline(
      track,
      "setup-track-outline",
    );
    this.root.querySelectorAll<HTMLElement>(".track-slide").forEach((slide) => {
      const active = slide.dataset.trackSlide === this.track;
      slide.classList.toggle("active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    this.trackStage?.setTrack(this.track, direction);
  }
  private keydown(event: KeyboardEvent): void {
    if (
      event.target instanceof Element &&
      event.target.closest(".board-track-menu")
    ) {
      if (this.boardTrackMenu(event)) return;
    }
    if (event.key === "Escape" && this.screen !== "garage") {
      event.preventDefault();
      this.setScreen(this.screen === "settings" ? "track" : "garage");
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest("input, select, textarea")
    )
      return;
    if (this.screen === "settings") {
      if (
        event.target instanceof Element &&
        event.target.closest(".board-diff-picker")
      ) {
        const index = DIFFICULTIES.indexOf(this.boardDifficulty);
        const next =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (index + 1) % DIFFICULTIES.length
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? (index - 1 + DIFFICULTIES.length) % DIFFICULTIES.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? DIFFICULTIES.length - 1
                  : -1;
        if (next !== -1) {
          event.preventDefault();
          this.chooseBoardDifficulty(DIFFICULTIES[next]);
          this.find(
            `.board-diff-opt[data-board-diff="${this.boardDifficulty}"]`,
          ).focus();
        }
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(".diff-picker")
      ) {
        const delta =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -1
              : 0;
        if (delta) {
          event.preventDefault();
          const index = DIFFICULTIES.indexOf(this.difficulty);
          this.chooseDifficulty(
            DIFFICULTIES[
              (index + delta + DIFFICULTIES.length) % DIFFICULTIES.length
            ],
          );
          this.find(`.diff-opt[data-diff="${this.difficulty}"]`).focus();
        }
        return;
      }
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".setup-menu")
      )
        return;
      const tabs: SetupTab[] = ["race", "records"];
      const delta =
        event.key === "ArrowDown" || event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? -1
            : 0;
      if (delta) {
        event.preventDefault();
        this.setSetupTab(
          tabs[
            (tabs.indexOf(this.setupTab) + delta + tabs.length) % tabs.length
          ],
        );
      }
      return;
    }
    let handled = true;
    if (this.screen === "track") {
      if (event.key === "ArrowLeft") this.cycleTrack(-1);
      else if (event.key === "ArrowRight") this.cycleTrack(1);
      else if (event.key === "Home") this.chooseTrack(TRACKS[0].id);
      else if (event.key === "End")
        this.chooseTrack(TRACKS[TRACKS.length - 1].id);
      else handled = false;
      if (
        handled &&
        event.target instanceof Element &&
        event.target.closest(".track-selector")
      )
        this.find(`.track-card[data-track="${this.track}"]`).focus();
    } else {
      if (event.key === "ArrowLeft") this.cycle(-1);
      else if (event.key === "ArrowRight") this.cycle(1);
      else if (event.key === "Home") this.chooseCar(CHOICES[0]);
      else if (event.key === "End") this.chooseCar(CHOICES[CHOICES.length - 1]);
      else handled = false;
      if (
        handled &&
        event.target instanceof Element &&
        event.target.closest(".garage")
      )
        this.find(`.garage-card[data-variant="${this.choice}"]`).focus();
    }
    if (handled) event.preventDefault();
  }
  private setScreen(screen: Screen): void {
    this.screen = screen;
    this.stage?.setActive(screen === "garage");
    this.trackStage?.setActive(screen === "track");
    this.find(".lobby-deck").dataset.screen = screen;
    for (const page of ["garage", "track", "settings"] as const) {
      const section = this.find(`.${page}-screen`);
      section.toggleAttribute("inert", page !== screen);
      section.setAttribute("aria-hidden", String(page !== screen));
      const step = this.find<HTMLButtonElement>(
        `[data-progress-screen="${page}"]`,
      );
      step.classList.toggle("active", page === screen);
      step.disabled =
        page === screen || page === "settings" || screen === "garage";
      if (page === screen) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    }
    if (screen === "settings")
      this.find(`[data-setup-tab="${this.setupTab}"]`).focus({
        preventScroll: true,
      });
    else
      this.find(
        screen === "track" ? "[data-select-track]" : "[data-select-car]",
      ).focus({ preventScroll: true });
  }
  private setSetupTab(tab: SetupTab): void {
    this.setupTab = tab;
    this.root
      .querySelectorAll<HTMLElement>("[data-setup-tab]")
      .forEach((button) => {
        const active = button.dataset.setupTab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
    this.root
      .querySelectorAll<HTMLElement>("[data-setup-panel]")
      .forEach((panel) => {
        panel.hidden = panel.dataset.setupPanel !== tab;
      });
    this.find(`[data-setup-tab="${tab}"]`).focus({ preventScroll: true });
  }
  private mark(selector: string, chosen: HTMLElement): void {
    this.root.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      node.classList.toggle("active", node === chosen);
      node.setAttribute("aria-checked", String(node === chosen));
    });
  }
  setConnection(state: "connected" | "connecting" | "offline"): void {
    const badge = this.find(".connection-status");
    badge.textContent =
      state === "connected" ? "LIVE MULTIPLAYER" : state.toUpperCase();
    badge.dataset.state = state;
  }
  paintGarageThumbnails(): void {
    this.images = renderVariantThumbnails(CAR_VARIANTS);
    for (const choice of CHOICES) {
      const variant = choice === "random" ? this.randomRoll : choice;
      const url = this.images.get(variant);
      const img = this.find<HTMLImageElement>(`[data-slide="${choice}"] img`);
      if (url) {
        img.src = url;
        img.hidden = false;
      }
    }
    this.find(".showroom-loading").hidden = this.images.size > 0;
    if (!this.stage) {
      try {
        this.stage = new GarageStage(
          this.find(".live-car-stage"),
          this.find(".car-stage"),
        );
        this.stage.setActive(
          this.screen === "garage" && this.root.style.display !== "none",
        );
      } catch {
        // The still previews also work when a second WebGL context is unavailable.
      }
    }
    if (!this.trackStage) {
      try {
        this.trackStage = new TrackStage(this.find(".live-track-stage"));
        this.trackStage.setActive(
          this.screen === "track" && this.root.style.display !== "none",
        );
      } catch {
        // Exact circuit outlines remain available without WebGL.
      }
    }
    this.paintTrack();
    this.paintHero();
  }
  private paintHero(): void {
    const index = CHOICES.indexOf(this.choice);
    const name = this.choice === "random" ? "Random" : LABELS[this.choice];
    this.find(".hero-car-name").textContent = name;
    this.find(".selected-car-name").textContent =
      this.choice === "random"
        ? `Random · ${LABELS[this.selectedVariant]}`
        : name;
    this.find(".stage-watermark").textContent = name;
    this.find(".showroom-number").textContent =
      this.choice === "random"
        ? "↝ / 08"
        : `${String(index + 1).padStart(2, "0")} / 08`;
    this.stage?.setVariant(this.selectedVariant, this.slideDirection);
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
    const thumb = this.find<HTMLImageElement>(".selected-car-thumb");
    if (url) {
      thumb.src = url;
      thumb.hidden = false;
      const hero = this.find<HTMLImageElement>(".setup-car-image");
      hero.src = url;
      hero.hidden = false;
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
        .map((room) =>
          row(
            room.id,
            `${outline(resolveTrack(room.track), "room-track-thumb")}<span class="room-name">${html(room.name)}<small class="room-track-name">${html(resolveTrack(room.track).name)}</small></span><span class="room-badge diff-${room.difficulty}">${DIFFICULTY_LABELS[room.difficulty]}</span><span class="room-count">${room.players} racing</span>`,
          ),
        )
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
    this.root
      .querySelectorAll<HTMLInputElement>('input[name="room-choice"]')
      .forEach((radio) => {
        radio.checked = radio.value === choice;
        radio.closest(".room-row")?.classList.toggle("active", radio.checked);
      });
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
    if (this.pacer?.kind === "ai") {
      if (!this.aiEligible()) this.pacer = null;
    } else if (this.pacer) {
      const name = this.pacer.name;
      const entry = this.eligible.find(
        (e) =>
          e.name === name &&
          e.track === this.pacer?.track &&
          e.difficulty === this.pacer?.difficulty,
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
    this.picker.value =
      this.pacer?.kind === "ai"
        ? "ai"
        : this.pacer
          ? String(this.eligible.findIndex((e) => e.name === this.pacer?.name))
          : "-1";
  }
  /** The visible Records list follows the board filters, not the race setup. */
  private paintBoard(): void {
    const { boardTrack, boardDifficulty } = this;
    const entries = this.entries.filter(
      (e) => e.track === boardTrack && e.difficulty === boardDifficulty,
    );
    this.root
      .querySelectorAll<HTMLElement>(".board-diff-opt")
      .forEach((button) => {
        const active = button.dataset.boardDiff === boardDifficulty;
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", String(active));
        button.tabIndex = active ? 0 : -1;
      });
    this.find(".board-track-label").textContent = resolveTrack(boardTrack).name;
    this.root
      .querySelectorAll<HTMLElement>(".board-track-opt")
      .forEach((option) => {
        const active = option.dataset.boardTrack === boardTrack;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", String(active));
      });
    const boardLabel = `${resolveTrack(boardTrack).name}, ${DIFFICULTY_LABELS[boardDifficulty]}`;
    const browsing =
      boardTrack !== this.track || boardDifficulty !== this.difficulty;
    this.find(".board-note-text").textContent =
      `Browsing only. Your race is still ${resolveTrack(this.track).name}, ${DIFFICULTY_LABELS[this.difficulty]}.`;
    this.find(".board-note").hidden = !browsing;
    this.find(".lb-empty-copy").textContent = `No laps yet on ${boardLabel}.`;
    this.find(".lb-empty").hidden = entries.length > 0;
    this.find(".lb-list").innerHTML = entries
      .map(
        (e) =>
          `<li><span class="lb-name">${html(e.name)}</span><span class="lb-time">${formatMs(e.timeMs)}</span>${e.hasReplay ? `<button class="lb-replay" data-replay="${html(e.name)}" data-track="${html(e.track)}" data-diff="${e.difficulty}" title="Watch replay" aria-label="Watch ${html(e.name)} replay">▶</button>` : ""}</li>`,
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
    this.stage?.setActive(this.screen === "garage");
    this.trackStage?.setActive(this.screen === "track");
  }
  hide(): void {
    this.root.style.display = "none";
    this.stage?.setActive(false);
    this.trackStage?.setActive(false);
  }
}
