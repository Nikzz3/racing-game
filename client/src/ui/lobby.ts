import type { LeaderboardEntry, RoomInfo } from "@racing/shared";
import { TRACK_NAME } from "@racing/shared";
import { escapeHtml, formatMs } from "../util";

export interface LobbyCallbacks {
  onCreate: (roomName: string) => void;
  onJoin: (roomId: string) => void;
}

const NAME_KEY = "racer-name";

export class Lobby {
  private root: HTMLElement;
  private nameInput: HTMLInputElement;
  private roomList: HTMLElement;
  private lbList: HTMLElement;

  constructor(parent: HTMLElement, callbacks: LobbyCallbacks) {
    this.root = document.createElement("div");
    this.root.className = "lobby-backdrop";
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
          <p class="subtitle">3D MULTIPLAYER RACING — ${escapeHtml(TRACK_NAME.toUpperCase())}</p>
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
              <button type="submit">Create &amp; Race</button>
            </form>
          </section>
          <section class="panel-laps">
            <h2><i class="dot gold"></i>Best Laps — All Time</h2>
            <ol class="lb-list"></ol>
            <div class="lb-empty" hidden>No laps recorded yet. Set the first time!</div>
          </section>
        </div>
        <p class="controls-hint"><b>W</b> throttle <b>S</b> brake <b>A</b><b>D</b> steer</p>
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
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      localStorage.setItem(NAME_KEY, this.playerName);
      callbacks.onCreate(roomNameInput.value.trim() || `${this.playerName}'s race`);
      roomNameInput.value = "";
    });

    this.roomList.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-room]");
      if (!btn) return;
      localStorage.setItem(NAME_KEY, this.playerName);
      callbacks.onJoin(btn.dataset.room!);
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
        <div class="room-row">
          <span class="room-name">${escapeHtml(r.name)}</span>
          <span class="room-count">${r.players} racing</span>
          <button data-room="${escapeHtml(r.id)}">Join</button>
        </div>`
      )
      .join("");
  }

  setLeaderboard(entries: LeaderboardEntry[]): void {
    const empty = this.root.querySelector<HTMLElement>(".lb-empty")!;
    empty.hidden = entries.length > 0;
    this.lbList.innerHTML = entries
      .map(
        (e) => `
        <li>
          <span class="lb-name">${escapeHtml(e.name)}</span>
          <span class="lb-time">${formatMs(e.timeMs)}</span>
        </li>`
      )
      .join("");
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
