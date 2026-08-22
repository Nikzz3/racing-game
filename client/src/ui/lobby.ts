import type { LeaderboardEntry, ReplayFrame, RoomInfo, Track, TrackSlug } from "@racing/shared";
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
import { buildReferenceLap, type ReferenceLap } from "../game/reference-lap";
import policy from "../../../rl/policy.json";
import { escapeHtml, formatMs } from "../util";

export interface LobbyCallbacks {
  onCreate: (roomName: string, track: TrackSlug, difficulty: Difficulty) => void;
  onJoin: (roomId: string) => void;
  onReplay: (name: string, track: TrackSlug, difficulty: Difficulty) => void;
  onReferenceLap: () => void;
}

/**
 * The single Pacer armed from the Starting Grid picker. A human Replay carries
 * its leaderboard entry (frames are fetched via getReplay at race start); the
 * AI Reference Lap carries its baked frames directly — it is never a
 * LeaderboardEntry and nothing is fetched for it (ADR-0006).
 */
export type ArmedPacer =
  | { kind: "replay"; name: string; track: TrackSlug; difficulty: Difficulty; entry: LeaderboardEntry }
  | { kind: "ai"; name: "AI Record"; track: TrackSlug; difficulty: "medium"; frames: ReplayFrame[] };

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

/** Leaderboard row action button carrying the (name, track, difficulty) key. */
function entryButton(
  e: LeaderboardEntry,
  className: string,
  action: string,
  title: string,
  label: string
): string {
  return `<button class="${className}" data-${action}="${escapeHtml(e.name)}" data-track="${escapeHtml(e.track)}" data-diff="${e.difficulty}" title="${title}">${label}</button>`;
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
  private _armedPacer: ArmedPacer | null = null;
  private pacerSelect: HTMLSelectElement;
  /** Entries selectable as Pacers for the current (track, difficulty); numeric option values index into this. */
  private eligible: LeaderboardEntry[] = [];
  /** Memoized AI Reference Lap bake; undefined = not yet baked, null = policy failed to lap. */
  private referenceLap: ReferenceLap | null | undefined = undefined;

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
            <label class="pacer-picker">
              <span class="pacer-picker-lead">Pacer</span>
              <select class="pacer-select"></select>
            </label>
            <form class="create-form">
              <input maxlength="24" placeholder="New room name" />
              <button type="submit">Create &amp; Race</button>
            </form>
          </section>
          <section class="panel-laps">
            <h2><i class="dot gold"></i>Best Laps — All Time</h2>
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
    this.pacerSelect = this.root.querySelector<HTMLSelectElement>(".pacer-select")!;
    this.pacerSelect.addEventListener("change", () => {
      const value = this.pacerSelect.value;
      if (value === "ai") {
        const lap = this.getReferenceLap();
        this._armedPacer = lap
          ? {
              kind: "ai",
              name: "AI Record",
              track: this.selectedTrack,
              difficulty: "medium",
              frames: lap.frames,
            }
          : null;
      } else {
        const entry = this.eligible[Number(value)];
        this._armedPacer = entry
          ? { kind: "replay", name: entry.name, track: entry.track, difficulty: entry.difficulty, entry }
          : null;
      }
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
    const shown = this.entries.filter(
      (e) => e.track === this.selectedTrack && e.difficulty === this.selectedDifficulty
    );
    this.eligible = shown.filter((e) => e.hasReplay);
    // Re-anchor the armed Pacer against the context now shown: the player may
    // have switched (track, difficulty) away from it, or a leaderboard refresh
    // may have replaced or dropped its entry. main.ts silently drops a
    // mismatched pacer at race start, so reflect that here rather than
    // advertise a stale one. Both the track and difficulty click handlers
    // route through renderBoard(), so this covers both.
    if (this._armedPacer) {
      const p = this._armedPacer;
      if (p.kind === "ai") {
        this._armedPacer = this.aiPacerEligible() && p.track === this.selectedTrack ? p : null;
      } else {
        const entry =
          this.eligible.find(
            (e) => e.name === p.name && e.track === p.track && e.difficulty === p.difficulty
          ) ?? null;
        this._armedPacer = entry
          ? { kind: "replay", name: entry.name, track: entry.track, difficulty: entry.difficulty, entry }
          : null;
      }
    }
    const empty = this.root.querySelector<HTMLElement>(".lb-empty")!;
    empty.hidden = shown.length > 0;
    this.lbList.innerHTML = shown
      .map(
        (e) => `
        <li>
          <span class="lb-name">${escapeHtml(e.name)}</span>
          <span class="lb-time">${formatMs(e.timeMs)}</span>
          ${e.hasReplay ? entryButton(e, "lb-replay", "replay", "Watch replay", "▶") : ""}
        </li>`
      )
      .join("");
    // AI Record: only for tracks that have a trained policy (Sunset Ridge), medium difficulty only.
    const aiRecordEl = this.root.querySelector<HTMLElement>(".lb-ai-record")!;
    aiRecordEl.hidden =
      !TRACKS_WITH_POLICY.has(this.selectedTrack) || this.selectedDifficulty !== "medium";
    this.renderPacerPicker();
  }

  get armedPacer(): ArmedPacer | null {
    return this._armedPacer;
  }

  /**
   * The AI Reference Lap, baked lazily from the bundled policy weights on the
   * first eligible render and memoized for the page (ADR-0006). This is the
   * single source of both the picker option's displayed time and the armed AI
   * Pacer's frames, so the two cannot diverge. Null when the policy fails to
   * complete a lap.
   */
  getReferenceLap(): ReferenceLap | null {
    if (this.referenceLap === undefined) this.referenceLap = buildReferenceLap(policy);
    return this.referenceLap;
  }

  /** Whether the AI Record can be offered as a Pacer in the current context (and its bake succeeded). */
  private aiPacerEligible(): boolean {
    return (
      TRACKS_WITH_POLICY.has(this.selectedTrack) &&
      this.selectedDifficulty === "medium" &&
      this.getReferenceLap() !== null
    );
  }

  /** Rebuild the Pacer picker's options for the current (track, difficulty). */
  private renderPacerPicker(): void {
    const aiLap = this.aiPacerEligible() ? this.getReferenceLap() : null;
    const options = this.eligible.map((e, i) => ({
      timeMs: e.timeMs,
      html: `<option value="${i}">⚑ ${escapeHtml(e.name)} — ${formatMs(e.timeMs)}</option>`,
    }));
    if (aiLap) {
      // Insert at the time-sorted position without reordering the human options.
      const ai = {
        timeMs: aiLap.timeMs,
        html: `<option value="ai" class="pacer-opt-ai">⚑ AI Record — ${formatMs(aiLap.timeMs)}</option>`,
      };
      const at = options.findIndex((o) => o.timeMs > aiLap.timeMs);
      options.splice(at === -1 ? options.length : at, 0, ai);
    }
    this.pacerSelect.innerHTML =
      `<option value="-1">No Pacer — race alone</option>` + options.map((o) => o.html).join("");
    this.pacerSelect.value = !this._armedPacer
      ? "-1"
      : this._armedPacer.kind === "ai"
        ? "ai"
        : String(this.eligible.indexOf(this._armedPacer.entry));
    this.pacerSelect.disabled = this.eligible.length === 0 && !aiLap;
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
