import type { LeaderboardEntry, RoomInfo, Track, TrackSlug } from "@racing/shared";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  TRACKS,
  resolveTrack,
  trackPath,
  type Difficulty,
} from "@racing/shared";
import { escapeHtml, formatMs } from "../util";

export interface LobbyCallbacks {
  onCreate: (roomName: string, track: TrackSlug, difficulty: Difficulty) => void;
  onJoin: (roomId: string) => void;
  onReplay: (name: string, track: TrackSlug, difficulty: Difficulty) => void;
  onReferenceLap: () => void;
}

/** Track slugs that have a trained AI policy (Reference Lap available). */
const TRACKS_WITH_POLICY = new Set<TrackSlug>(["sunset-ridge"]);

const NAME_KEY = "racer-name";

function trackViewBox(track: Track): string {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of track.samples) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }
  const pad = 20;
  return `${(minX - pad).toFixed(0)} ${(minZ - pad).toFixed(0)} ${(maxX - minX + 2 * pad).toFixed(0)} ${(maxZ - minZ + 2 * pad).toFixed(0)}`;
}

/** Top-down SVG outline of a track's centerline, sized to its bounding box. */
function trackOutlineSvg(track: Track, className: string): string {
  const vb = trackViewBox(track);
  const path = trackPath(track);
  return `<svg class="${className}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="8"/></svg>`;
}

function trackCardHtml(track: Track, active: boolean): string {
  return `<button type="button" class="track-card${active ? " active" : ""}" data-track="${escapeHtml(track.id)}">${trackOutlineSvg(track, "track-outline")}<span class="track-card-name">${escapeHtml(track.name)}</span></button>`;
}

function trackThumbHtml(track: Track): string {
  return trackOutlineSvg(track, "room-track-thumb");
}

export class Lobby {
  private root: HTMLElement;
  private nameInput: HTMLInputElement;
  private roomList: HTMLElement;
  private lbList: HTMLElement;
  private onReferenceLap: () => void;

  /** Currently selected track — drives both create-Room and leaderboard. */
  private selectedTrack: TrackSlug = DEFAULT_TRACK_SLUG;
  /** Currently selected difficulty — drives both create-Room and leaderboard. */
  private selectedDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  private entries: LeaderboardEntry[] = [];
  private _armedPacer: LeaderboardEntry | null = null;
  private pacerBanner: HTMLElement;

  constructor(parent: HTMLElement, callbacks: LobbyCallbacks) {
    this.onReferenceLap = callbacks.onReferenceLap;
    this.root = document.createElement("div");
    this.root.className = "lobby-backdrop";

    const trackCards = TRACKS.map((t) => trackCardHtml(t, t.id === DEFAULT_TRACK_SLUG)).join("");
    const difficultyOptions = DIFFICULTIES.map(
      (d) =>
        `<button type="button" class="diff-opt diff-${d}${d === this.selectedDifficulty ? " active" : ""}" data-diff="${d}">${DIFFICULTY_LABELS[d]}</button>`
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
        <div class="track-selector" role="radiogroup" aria-label="Track">${trackCards}</div>
        <div class="diff-picker" role="radiogroup" aria-label="Difficulty">${difficultyOptions}</div>
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
            <div class="pacer-banner" hidden>
              <span class="pacer-banner-info"></span>
              <button type="button" class="pacer-clear" aria-label="Clear pacer">&#x2715;</button>
            </div>
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
    this.pacerBanner = this.root.querySelector<HTMLElement>(".pacer-banner")!;
    this.pacerBanner.querySelector<HTMLButtonElement>(".pacer-clear")!.addEventListener("click", () => {
      this._armedPacer = null;
      this.renderPacerBanner();
    });

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
      callbacks.onCreate(
        roomNameInput.value.trim() || `${this.playerName}'s race`,
        this.selectedTrack,
        this.selectedDifficulty
      );
      roomNameInput.value = "";
    });

    const trackSelector = this.root.querySelector<HTMLElement>(".track-selector")!;
    trackSelector.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-track]");
      if (!btn) return;
      this.selectedTrack = btn.dataset.track as TrackSlug;
      trackSelector
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => b.classList.toggle("active", b === btn));
      this.renderBoard();
    });

    const diffPicker = this.root.querySelector<HTMLElement>(".diff-picker")!;
    diffPicker.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-diff]");
      if (!btn) return;
      this.selectedDifficulty = btn.dataset.diff as Difficulty;
      diffPicker
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
      if (replayBtn) callbacks.onReplay(replayBtn.dataset.replay!, replayBtn.dataset.track!, replayBtn.dataset.diff as Difficulty);
      const paceBtn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-pace]");
      if (paceBtn) {
        const entry = this.entries.find(
          (en) => en.name === paceBtn.dataset.pace && en.track === paceBtn.dataset.track && en.difficulty === paceBtn.dataset.diff
        );
        if (entry) {
          this._armedPacer = entry;
          this.renderPacerBanner();
        }
      }
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
      .map((r) => {
        const track = resolveTrack(r.track);
        const thumb = trackThumbHtml(track);
        return `<div class="room-row diff-edge-${r.difficulty}">${thumb}<span class="room-track-name">${escapeHtml(track.name)}</span><span class="room-name">${escapeHtml(r.name)}</span><span class="room-badge diff-${r.difficulty}">${DIFFICULTY_LABELS[r.difficulty]}</span><span class="room-count">${r.players} racing</span><button data-room="${escapeHtml(r.id)}">Join</button></div>`;
      })
      .join("");
  }

  setLeaderboard(entries: LeaderboardEntry[]): void {
    this.entries = entries;
    this.renderBoard();
  }

  private renderBoard(): void {
    // A pacer armed for one (track, difficulty) no longer applies once the
    // player switches away from it — main.ts silently drops the mismatched
    // pacer at race start, so clear it here and hide the banner rather than
    // leave a stale pacer advertised. Both the track and difficulty click
    // handlers route through renderBoard(), so this covers both.
    if (
      this._armedPacer &&
      (this._armedPacer.track !== this.selectedTrack ||
        this._armedPacer.difficulty !== this.selectedDifficulty)
    ) {
      this._armedPacer = null;
      this.renderPacerBanner();
    }
    const shown = this.entries.filter(
      (e) => e.track === this.selectedTrack && e.difficulty === this.selectedDifficulty
    );
    const empty = this.root.querySelector<HTMLElement>(".lb-empty")!;
    empty.hidden = shown.length > 0;
    this.lbList.innerHTML = shown
      .map(
        (e) => `
        <li>
          <span class="lb-name">${escapeHtml(e.name)}</span>
          <span class="lb-time">${formatMs(e.timeMs)}</span>
          ${e.hasReplay ? `<button class="lb-replay" data-replay="${escapeHtml(e.name)}" data-track="${escapeHtml(e.track)}" data-diff="${e.difficulty}" title="Watch replay">▶</button><button class="lb-pace" data-pace="${escapeHtml(e.name)}" data-track="${escapeHtml(e.track)}" data-diff="${e.difficulty}" title="Arm as Pacer">🏁</button>` : ""}
        </li>`
      )
      .join("");
    // AI Record: only for tracks that have a trained policy (Sunset Ridge), medium difficulty only.
    const aiRecordEl = this.root.querySelector<HTMLElement>(".lb-ai-record")!;
    aiRecordEl.hidden =
      !TRACKS_WITH_POLICY.has(this.selectedTrack) || this.selectedDifficulty !== "medium";
  }

  get armedPacer(): LeaderboardEntry | null {
    return this._armedPacer;
  }

  private renderPacerBanner(): void {
    if (this._armedPacer) {
      this.pacerBanner.hidden = false;
      this.pacerBanner.querySelector<HTMLElement>(".pacer-banner-info")!.textContent =
        `🏁 ${this._armedPacer.name} — ${formatMs(this._armedPacer.timeMs)}`;
    } else {
      this.pacerBanner.hidden = true;
    }
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
