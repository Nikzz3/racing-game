import type { LeaderboardEntry, RoomInfo } from "@racing/shared";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  type Difficulty,
} from "@racing/shared";
import { escapeHtml, formatMs } from "../util";

export interface LobbyCallbacks {
  onCreate: (roomName: string, difficulty: Difficulty) => void;
  onJoin: (roomId: string) => void;
  onReplay: (name: string, difficulty: Difficulty) => void;
  onReferenceLap: () => void;
}

const NAME_KEY = "racer-name";

export class Lobby {
  private root: HTMLElement;
  private nameInput: HTMLInputElement;
  private roomList: HTMLElement;
  private lbList: HTMLElement;
  private onReferenceLap: () => void;

  /** Difficulty chosen for the next created room. */
  private createDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  /** Which difficulty's board is currently shown. */
  private boardDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  private entries: LeaderboardEntry[] = [];

  constructor(parent: HTMLElement, callbacks: LobbyCallbacks) {
    this.onReferenceLap = callbacks.onReferenceLap;
    this.root = document.createElement("div");
    this.root.className = "lobby-backdrop";
    const difficultyOptions = DIFFICULTIES.map(
      (d) =>
        `<button type="button" class="diff-opt diff-${d}${d === this.createDifficulty ? " active" : ""}" data-create-diff="${d}">${DIFFICULTY_LABELS[d]}</button>`
    ).join("");
    const boardTabs = DIFFICULTIES.map(
      (d) =>
        `<button type="button" class="lb-tab diff-${d}${d === this.boardDifficulty ? " active" : ""}" data-board-diff="${d}">${DIFFICULTY_LABELS[d]}</button>`
    ).join("");
    this.root.innerHTML = `
      <div class="lobby-scene" aria-hidden="true">
        <div class="scene-stars"></div>
        <div class="scene-sun"></div>
        <div class="scene-mountains"></div>
        <div class="scene-grid-wrap"><div class="scene-grid"></div></div>
        <div class="scene-haze"></div>
      </div>
      <div class="lobby">
        <div class="lobby-flag-strip"></div>
        <header class="lobby-header">
          <p class="lobby-kicker">// IGNITION SEQUENCE</p>
          <h1 class="lobby-title">SUNSET<span>RIDGE</span></h1>
          <p class="subtitle">3D MULTIPLAYER RACING</p>
        </header>
        <div class="name-row">
          <label for="driver-name">Driver</label>
          <input id="driver-name" maxlength="16" placeholder="Your name" autocomplete="off" />
          <span class="name-tag">P1</span>
        </div>
        <div class="lobby-columns">
          <section class="panel-rooms">
            <h2><i class="dot"></i>Starting Grid</h2>
            <div class="room-list"></div>
            <form class="create-form">
              <input maxlength="24" placeholder="New room name" />
              <div class="diff-picker" role="radiogroup" aria-label="Difficulty">${difficultyOptions}</div>
              <button type="submit">Create &amp; Race</button>
            </form>
          </section>
          <section class="panel-laps">
            <h2><i class="dot gold"></i>Best Laps — All Time</h2>
            <div class="lb-tabs">${boardTabs}</div>
            <ol class="lb-list"></ol>
            <div class="lb-empty" hidden>No laps recorded yet. Set the first time!</div>
            <div class="lb-ai-record" hidden>
              <button class="lb-ai-record-btn" data-ai-record="1">▶ Watch AI Record</button>
            </div>
          </section>
        </div>
        <p class="controls-hint"><span><b>W</b> throttle</span> <span><b>S</b> brake</span> <span><b>A</b><b>D</b> steer</span></p>
      </div>
    `;
    parent.appendChild(this.root);

    this.nameInput = this.root.querySelector<HTMLInputElement>("#driver-name")!;
    this.roomList = this.root.querySelector<HTMLElement>(".room-list")!;
    this.lbList = this.root.querySelector<HTMLElement>(".lb-list")!;

    this.nameInput.value =
      localStorage.getItem(NAME_KEY) ?? `Racer${Math.floor(Math.random() * 900) + 100}`;
    this.nameInput.addEventListener("change", () => {
      localStorage.setItem(NAME_KEY, this.playerName);
    });

    const form = this.root.querySelector<HTMLFormElement>(".create-form")!;
    const roomNameInput = form.querySelector<HTMLInputElement>("input")!;
    const diffPicker = form.querySelector<HTMLElement>(".diff-picker")!;
    diffPicker.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-create-diff]");
      if (!btn) return;
      this.createDifficulty = btn.dataset.createDiff as Difficulty;
      diffPicker
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => b.classList.toggle("active", b === btn));
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      localStorage.setItem(NAME_KEY, this.playerName);
      callbacks.onCreate(roomNameInput.value.trim() || `${this.playerName}'s race`, this.createDifficulty);
      roomNameInput.value = "";
    });

    const tabs = this.root.querySelector<HTMLElement>(".lb-tabs")!;
    tabs.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-board-diff]");
      if (!btn) return;
      this.boardDifficulty = btn.dataset.boardDiff as Difficulty;
      tabs
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => b.classList.toggle("active", b === btn));
      this.renderBoard();
    });

    this.roomList.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-room]");
      if (!btn) return;
      localStorage.setItem(NAME_KEY, this.playerName);
      callbacks.onJoin(btn.dataset.room!);
    });

    this.lbList.addEventListener("click", (e) => {
      const replayBtn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-replay]");
      if (replayBtn) callbacks.onReplay(replayBtn.dataset.replay!, replayBtn.dataset.diff as Difficulty);
    });

    this.root.querySelector<HTMLElement>(".lb-ai-record")!.addEventListener("click", () => {
      this.onReferenceLap();
    });

    this.setRooms([]);
    this.setLeaderboard([]);
  }

  get playerName(): string {
    return this.nameInput.value.trim().slice(0, 16) || "Racer";
  }

  setRooms(rooms: RoomInfo[]): void {
    if (rooms.length === 0) {
      this.roomList.innerHTML = `<div class="rooms-empty">No rooms yet — create one below.</div>`;
      return;
    }
    this.roomList.innerHTML = rooms
      .map(
        (r) => `
        <div class="room-row diff-edge-${r.difficulty}">
          <span class="room-name">${escapeHtml(r.name)}</span>
          <span class="room-badge diff-${r.difficulty}">${DIFFICULTY_LABELS[r.difficulty]}</span>
          <span class="room-count">${r.players} racing</span>
          <button data-room="${escapeHtml(r.id)}">Join</button>
        </div>`
      )
      .join("");
  }

  setLeaderboard(entries: LeaderboardEntry[]): void {
    this.entries = entries;
    this.renderBoard();
  }

  /** Render only the entries for the currently selected difficulty tab. */
  private renderBoard(): void {
    const shown = this.entries.filter((e) => e.difficulty === this.boardDifficulty);
    const empty = this.root.querySelector<HTMLElement>(".lb-empty")!;
    empty.hidden = shown.length > 0;
    this.lbList.innerHTML = shown
      .map(
        (e) => `
        <li>
          <span class="lb-name">${escapeHtml(e.name)}</span>
          <span class="lb-time">${formatMs(e.timeMs)}</span>
          ${e.hasReplay ? `<button class="lb-replay" data-replay="${escapeHtml(e.name)}" data-diff="${e.difficulty}" title="Watch replay">▶</button>` : ""}
        </li>`
      )
      .join("");
    // AI Record button — Medium only (policy trained and validated on Medium).
    const aiRecordEl = this.root.querySelector<HTMLElement>(".lb-ai-record")!;
    aiRecordEl.hidden = this.boardDifficulty !== "medium";
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
