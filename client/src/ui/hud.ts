import {
  COUNTDOWN_MS,
  trackPath,
  type PlayerSnapshot,
  type RaceEntrant,
  type RaceFormat,
  type RaceState,
  type Track,
} from "@racing/shared";
import type { RemotePosition } from "../game/remote";
import { escapeHtml, formatMs } from "../util";

// Cosmetic gauge calibration; physics and network speeds remain in world units.
const DISPLAY_SPEED_SCALE = 0.5;
const DIAL_MAX_KMH = 200;
// The lap time redraws at most this often (20 Hz): every new string re-rasters the
// 48px digits, and nobody reads milliseconds at 60 Hz anyway.
const LAP_TIMER_STEP_MS = 50;
/** How long "GO!" stays up once the countdown ends. */
const GO_SHOWN_MS = 1000;

/** What the HUD's race controls ask the Room for. */
export interface RaceControls {
  start(format: RaceFormat): void;
  /** Watch the previous (-1) or next (1) car still racing. */
  cycle(step: 1 | -1): void;
}

/** The countdown overlay: whole seconds to GO, then "GO!" for a second; null otherwise. */
function countdownLabel(race: RaceState | null, serverNow: number): string | null {
  if (!race || race.phase === "results") return null;
  const toGo = race.goT - serverNow;
  // The clock trails the server's by the network delay, so it can read past a full countdown.
  if (toGo > 0) return String(Math.min(Math.ceil(toGo / 1000), COUNTDOWN_MS / 1000));
  return toGo > -GO_SHOWN_MS ? "GO!" : null;
}

/** A standings or results row's last column: laps while racing, the finish time, or how it ended. */
function entrantStatus(entrant: RaceEntrant, race: RaceState): string {
  if (entrant.status === "racing") return `L${entrant.laps}/${race.laps}`;
  if (entrant.status === "finished") return formatMs(entrant.finishMs);
  return race.format === "knockout" ? "OUT" : "DNF";
}

function entrantClass(entrant: RaceEntrant, myId: string): string {
  return [entrant.status, entrant.id === myId && "me", entrant.pacer && "pacer"]
    .filter(Boolean)
    .join(" ");
}

/**
 * Places a circuit-map marker, in whole circuit units (a third of a pixel on the
 * full-size map). The marker is its own compositor layer and CSS turns the two
 * custom properties into a translate(), so moving it never repaints the map;
 * unchanged positions skip the write entirely.
 */
function placeMapDot(dot: HTMLElement, x: number, z: number): void {
  const mx = String(Math.round(x)),
    mz = String(Math.round(z));
  if (dot.style.getPropertyValue("--x") !== mx) dot.style.setProperty("--x", mx);
  if (dot.style.getPropertyValue("--z") !== mz) dot.style.setProperty("--z", mz);
}

export class Hud {
  private readonly root = document.createElement("div");
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly fields = new Map<string, HTMLElement>();
  private standings = "";
  private race: RaceState | null = null;
  private raceRows = "";
  private resultRows = "";
  /** While the driver is an entrant, the lap of the race they are on, over the session's lap count. */
  private raceLap: string | null = null;
  private dial = "";
  private lapShown: number | null = null;
  private checkpointFill = "";
  private readonly remoteDots = new Map<string, HTMLElement>();
  constructor(
    parent: HTMLElement,
    roomName: string,
    onLeave: () => void,
    private readonly checkpointCount: number,
    onRespawn?: () => void,
    track?: Track,
    race?: RaceControls,
  ) {
    this.root.className = "hud";
    this.root.innerHTML = `<div class="hud-panel hud-top-left"><div class="hud-room">${escapeHtml(roomName)}</div><div class="hud-progress"><div class="hud-lap">LAP 0</div><div class="hud-cp">CP 0/${checkpointCount}</div></div><div class="hud-checkpoint-bar"><i></i></div><div class="race-position" hidden></div><div class="pacer-chip"><span class="pacer-chip-label">PACER</span><span class="pacer-chip-name"></span><button class="pacer-chip-dismiss" title="Dismiss Pacer" aria-label="Dismiss Pacer">✕</button></div></div>
    <div class="hud-panel hud-timer"><div class="hud-timer-label">LAP TIME</div><div class="hud-cur-lap">--:--.---</div><div class="hud-lap-small"><span>LAST <b class="hud-last">--:--.---</b></span><span>BEST <b class="hud-best">--:--.---</b></span></div></div>
    <div class="hud-panel hud-standings"><h3>BEST LAPS</h3><table><tbody></tbody></table></div>
    <div class="hud-panel race-standings" hidden><h3>RACE</h3><table><tbody></tbody></table></div>
    <div class="hud-panel hud-speed"><svg class="speed-dial" viewBox="0 0 200 200" aria-hidden="true"><path class="speed-dial-shadow" d="M 36 155 A 84 84 0 1 1 164 155"/><path class="speed-dial-track" d="M 36 155 A 84 84 0 1 1 164 155" pathLength="100"/><path class="speed-dial-fill" d="M 36 155 A 84 84 0 1 1 164 155" pathLength="100"/></svg><span class="speed-value">0</span><span class="speed-unit">KM/H</span></div>
    ${track ? `<div class="hud-map"><div class="hud-map-plot"><svg viewBox="-265 -250 530 500" aria-label="Circuit map"><path class="hud-map-shadow" d="${trackPath(track)}"/><path d="${trackPath(track)}"/></svg><div class="hud-map-remotes"></div><i class="hud-map-dot hud-map-driver"></i></div><span>${escapeHtml(track.name.replace(" Circuit", ""))}</span></div>` : ""}
    <div class="hud-actions"><button class="hud-leave">Leave race</button>${onRespawn ? '<button class="hud-respawn">Respawn</button>' : ""}<button class="hud-start-race">Start race</button><button class="hud-start-knockout">Start knockout</button></div>
    <div class="offtrack-warn">OFF TRACK</div><div class="cp-miss-warn">CHECKPOINT MISSED<span>Respawn or drive back through the gate</span></div>
    <div class="race-countdown"></div>
    <div class="spectator-banner"><button class="spectator-prev" aria-label="Previous car">‹</button><div class="spectator-info"><span class="spectator-label">SPECTATING</span><span class="spectator-target"></span></div><button class="spectator-next" aria-label="Next car">›</button></div>
    <div class="race-results"><h2></h2><ol class="race-results-list"></ol><div class="race-results-return"></div></div>
    <div class="toasts" role="status" aria-live="polite"></div>`;
    parent.append(this.root);
    this.el(".hud-leave").onclick = onLeave;
    if (onRespawn) this.el(".hud-respawn").onclick = onRespawn;
    if (race) {
      this.el(".hud-start-race").onclick = () => race.start("race");
      this.el(".hud-start-knockout").onclick = () => race.start("knockout");
      this.el(".spectator-prev").onclick = () => race.cycle(-1);
      this.el(".spectator-next").onclick = () => race.cycle(1);
    }
    if (track) placeMapDot(this.el(".hud-map-driver"), track.samples[0].x, track.samples[0].z);
  }
  private el(selector: string): HTMLElement {
    let element = this.fields.get(selector);
    if (!element) {
      element = this.root.querySelector<HTMLElement>(selector)!;
      this.fields.set(selector, element);
    }
    return element;
  }
  private text(selector: string, value: string): void {
    const element = this.el(selector);
    if (element.textContent !== value) element.textContent = value;
  }
  setSpeed(speed: number): void {
    const kmh = Math.round(Math.abs(speed) * 3.6 * DISPLAY_SPEED_SCALE);
    this.text(".speed-value", String(kmh));
    const dial = `${Math.min(100, (kmh / DIAL_MAX_KMH) * 100)} 100`;
    if (dial === this.dial) return;
    this.dial = dial;
    this.el(".speed-dial-fill").style.strokeDasharray = dial;
  }
  setPosition(x: number, z: number): void {
    const dot = this.el(".hud-map-driver");
    if (dot) placeMapDot(dot, x, z);
  }
  /** The local driver's circuit-map marker; a Spectator has no car to mark. */
  setDriverShown(shown: boolean): void {
    const dot = this.el(".hud-map-driver");
    if (dot && dot.hidden === shown) dot.hidden = !shown;
  }
  /** Mirror the other drivers in the room, and a race's grid Pacers, onto the circuit map. */
  setRemotePositions(positions: RemotePosition[], pacers: RemotePosition[] = []): void {
    const group = this.el(".hud-map-remotes");
    if (!group) return;
    const seen = new Set<string>();
    for (const [list, className] of [
      [positions, "hud-map-dot hud-map-remote"],
      [pacers, "hud-map-dot hud-map-remote hud-map-pacer"],
    ] as const) {
      for (const { id, x, z } of list) {
        seen.add(id);
        let dot = this.remoteDots.get(id);
        if (!dot) {
          dot = document.createElement("i");
          dot.className = className;
          this.remoteDots.set(id, dot);
          group.append(dot);
        }
        placeMapDot(dot, x, z);
      }
    }
    for (const [id, dot] of this.remoteDots) {
      if (seen.has(id)) continue;
      dot.remove();
      this.remoteDots.delete(id);
    }
  }
  setCurrentLap(time: number | null): void {
    const shown = this.lapShown;
    // A reset (respawn, new lap) or a cleared clock shows at once; ticking waits a step.
    if (time !== null && shown !== null && time >= shown && time - shown < LAP_TIMER_STEP_MS)
      return;
    this.lapShown = time;
    this.text(".hud-cur-lap", formatMs(time));
  }
  setOffTrack(off: boolean): void {
    this.el(".offtrack-warn").classList.toggle("visible", off);
  }
  setCheckpointMissed(missed: boolean): void {
    this.el(".cp-miss-warn").classList.toggle("visible", missed);
  }
  setMyProgress(player: PlayerSnapshot): void {
    this.text(".hud-lap", this.raceLap ?? `LAP ${player.laps}`);
    this.text(".hud-cp", `CP ${player.nextCheckpoint}/${this.checkpointCount}`);
    // Scaling, not resizing, keeps the fill's 0.3s ease on the compositor
    // instead of forcing a layout on every frame of each checkpoint's animation.
    const fill = `scaleX(${Math.min(1, player.nextCheckpoint / this.checkpointCount)})`;
    if (fill !== this.checkpointFill) {
      this.checkpointFill = fill;
      this.el(".hud-checkpoint-bar i").style.transform = fill;
    }
    this.text(".hud-last", formatMs(player.lastLapMs));
    this.text(".hud-best", formatMs(player.bestLapMs));
  }
  setStandings(players: PlayerSnapshot[], id: string): void {
    const sorted = [...players].sort(
      (a, b) =>
        (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) || a.name.localeCompare(b.name),
    );
    const markup = sorted
      .map(
        (p, i) =>
          `<tr class="${p.id === id ? "me" : ""}"><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td class="st-time">${formatMs(p.bestLapMs)}</td><td class="st-time">L${p.laps}</td></tr>`,
      )
      .join("");
    if (markup === this.standings) return;
    this.standings = markup;
    this.el(".hud-standings tbody").innerHTML = markup;
  }
  /** Show the Room's race as the driver `myId` sees it; null returns the HUD to free driving. */
  setRace(race: RaceState | null, myId: string): void {
    this.race = race;
    const startable = !race || race.phase === "results";
    this.el(".hud-start-race").hidden = !startable;
    this.el(".hud-start-knockout").hidden = !startable;
    this.el(".hud-standings").hidden = race !== null;
    // The results screen shows the same order, final.
    this.el(".race-standings").hidden = race === null || race.phase === "results";
    this.el(".race-results").classList.toggle("visible", race?.phase === "results");
    const index = race ? race.entrants.findIndex((e) => e.id === myId) : -1;
    const me = race && index >= 0 ? race.entrants[index] : null;
    const position =
      race && me?.status === "racing" ? `P${index + 1}/${race.entrants.length}` : null;
    this.el(".race-position").hidden = position === null;
    if (position) this.text(".race-position", position);
    this.raceLap = race && me ? `LAP ${Math.min(me.laps + 1, race.laps)}/${race.laps}` : null;
    if (this.raceLap) this.text(".hud-lap", this.raceLap);
    if (race) this.setClassification(race, myId);
  }
  /** The race's order: live standings, and the results screen once it is over. */
  private setClassification(race: RaceState, myId: string): void {
    const title = race.format === "knockout" ? "KNOCKOUT" : "RACE";
    this.text(".race-standings h3", title);
    const rows = race.entrants
      .map(
        (e, i) =>
          `<tr class="${entrantClass(e, myId)}"><td class="rs-pos">${i + 1}</td><td class="rs-name">${escapeHtml(e.name)}</td><td class="rs-status">${entrantStatus(e, race)}</td></tr>`,
      )
      .join("");
    if (rows !== this.raceRows) {
      this.raceRows = rows;
      this.el(".race-standings tbody").innerHTML = rows;
    }
    if (race.phase !== "results") return;
    this.text(".race-results h2", `${title} RESULTS`);
    const results = race.entrants
      .map(
        (e, i) =>
          `<li class="${entrantClass(e, myId)}"><span class="rr-pos">${i + 1}</span><span class="rr-name">${escapeHtml(e.name)}</span><span class="rr-time">${entrantStatus(e, race)}</span></li>`,
      )
      .join("");
    if (results !== this.resultRows) {
      this.resultRows = results;
      this.el(".race-results-list").innerHTML = results;
    }
  }
  /** Per frame: the countdown to GO, and the results screen's wait for free driving, at server time `serverNow`. */
  setRaceClock(serverNow: number): void {
    const label = countdownLabel(this.race, serverNow);
    this.el(".race-countdown").classList.toggle("visible", label !== null);
    if (label !== null) this.text(".race-countdown", label);
    const deadline = this.race?.phase === "results" ? this.race.deadlineT : undefined;
    if (deadline !== undefined)
      this.text(
        ".race-results-return",
        `Free driving in ${Math.max(0, Math.ceil((deadline - serverNow) / 1000))}s`,
      );
  }
  /** The Spectator banner, naming the car being watched; null hides it. */
  setSpectating(target: string | null): void {
    this.el(".spectator-banner").classList.toggle("visible", target !== null);
    if (target !== null) this.text(".spectator-target", target);
  }
  /** Respawn is off while the car waits on the grid for GO, and for a Spectator. */
  setRespawnEnabled(enabled: boolean): void {
    const button = this.el(".hud-respawn") as HTMLButtonElement | null;
    if (button && button.disabled === enabled) button.disabled = !enabled;
  }
  showPacerChip(onDismiss: () => void, name = ""): void {
    this.el(".pacer-chip-dismiss").onclick = onDismiss;
    this.text(".pacer-chip-name", name);
    this.el(".pacer-chip").classList.add("visible");
  }
  hidePacerChip(): void {
    this.el(".pacer-chip").classList.remove("visible");
  }
  toast(message: string, record = false): void {
    const item = document.createElement("div");
    item.className = record ? "toast record" : "toast";
    item.textContent = message;
    this.el(".toasts").append(item);
    const timer = setTimeout(() => {
      item.remove();
      this.timers.delete(timer);
    }, 3800);
    this.timers.add(timer);
  }
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.root.remove();
  }
}
