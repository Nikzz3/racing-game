import { trackPath, type PlayerSnapshot, type Track } from "@racing/shared";
import type { RemotePosition } from "../game/remote";
import { escapeHtml, formatMs } from "../util";

const SVG_NS = "http://www.w3.org/2000/svg";

// Cosmetic gauge calibration; physics and network speeds remain in world units.
const DISPLAY_SPEED_SCALE = 0.5;
const DIAL_MAX_KMH = 200;

export class Hud {
  private readonly root = document.createElement("div");
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly fields = new Map<string, HTMLElement>();
  private standings = "";
  private dial = "";
  private dot = "";
  private readonly remoteDots = new Map<string, SVGCircleElement>();
  constructor(
    parent: HTMLElement,
    roomName: string,
    onLeave: () => void,
    private readonly checkpointCount: number,
    onRespawn?: () => void,
    track?: Track,
  ) {
    this.root.className = "hud";
    this.root.innerHTML = `<div class="hud-panel hud-top-left"><div class="hud-room">${escapeHtml(roomName)}</div><div class="hud-progress"><div class="hud-lap">LAP 0</div><div class="hud-cp">CP 0/${checkpointCount}</div></div><div class="hud-checkpoint-bar"><i></i></div><div class="pacer-chip"><span class="pacer-chip-label">PACER</span><span class="pacer-chip-name"></span><button class="pacer-chip-dismiss" title="Dismiss Pacer" aria-label="Dismiss Pacer">✕</button></div></div>
    <div class="hud-panel hud-timer"><div class="hud-timer-label">LAP TIME</div><div class="hud-cur-lap">--:--.---</div><div class="hud-lap-small"><span>LAST <b class="hud-last">--:--.---</b></span><span>BEST <b class="hud-best">--:--.---</b></span></div></div>
    <div class="hud-panel hud-standings"><h3>BEST LAPS</h3><table><tbody></tbody></table></div>
    <div class="hud-panel hud-speed"><svg class="speed-dial" viewBox="0 0 200 200" aria-hidden="true"><path class="speed-dial-track" d="M 36 155 A 84 84 0 1 1 164 155" pathLength="100"/><path class="speed-dial-fill" d="M 36 155 A 84 84 0 1 1 164 155" pathLength="100"/></svg><span class="speed-value">0</span><span class="speed-unit">KM/H</span></div>
    ${track ? `<div class="hud-map"><svg viewBox="-265 -250 530 500" aria-label="Circuit map"><path d="${trackPath(track)}"/><g class="hud-map-remotes"></g><circle class="hud-map-driver" r="10" cx="${track.samples[0].x}" cy="${track.samples[0].z}"/></svg><span>${escapeHtml(track.name.replace(" Circuit", ""))}</span></div>` : ""}
    <div class="hud-actions"><button class="hud-leave">Leave race</button>${onRespawn ? '<button class="hud-respawn">Respawn</button>' : ""}</div>
    <div class="offtrack-warn">OFF TRACK</div><div class="cp-miss-warn">CHECKPOINT MISSED<span>Respawn or drive back through the gate</span></div><div class="toasts" role="status" aria-live="polite"></div>`;
    parent.append(this.root);
    this.el(".hud-leave").onclick = onLeave;
    if (onRespawn) this.el(".hud-respawn").onclick = onRespawn;
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
    if (!dot) return;
    const cx = x.toFixed(1),
      cy = z.toFixed(1);
    if (cx + cy === this.dot) return;
    this.dot = cx + cy;
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
  }
  /** Mirror the other drivers in the room onto the circuit map. */
  setRemotePositions(positions: RemotePosition[]): void {
    const group = this.el(".hud-map-remotes");
    if (!group) return;
    const seen = new Set<string>();
    for (const { id, x, z } of positions) {
      seen.add(id);
      let dot = this.remoteDots.get(id);
      if (!dot) {
        dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "hud-map-remote");
        dot.setAttribute("r", "8");
        this.remoteDots.set(id, dot);
        group.append(dot);
      }
      const cx = x.toFixed(1),
        cy = z.toFixed(1);
      if (dot.getAttribute("cx") !== cx) dot.setAttribute("cx", cx);
      if (dot.getAttribute("cy") !== cy) dot.setAttribute("cy", cy);
    }
    for (const [id, dot] of this.remoteDots) {
      if (seen.has(id)) continue;
      dot.remove();
      this.remoteDots.delete(id);
    }
  }
  setCurrentLap(time: number | null): void {
    this.text(".hud-cur-lap", formatMs(time));
  }
  setOffTrack(off: boolean): void {
    this.el(".offtrack-warn").classList.toggle("visible", off);
  }
  setCheckpointMissed(missed: boolean): void {
    this.el(".cp-miss-warn").classList.toggle("visible", missed);
  }
  setMyProgress(player: PlayerSnapshot): void {
    this.text(".hud-lap", `LAP ${player.laps}`);
    this.text(".hud-cp", `CP ${player.nextCheckpoint}/${this.checkpointCount}`);
    this.el(".hud-checkpoint-bar i").style.width =
      `${Math.min(100, (player.nextCheckpoint / this.checkpointCount) * 100)}%`;
    this.text(".hud-last", formatMs(player.lastLapMs));
    this.text(".hud-best", formatMs(player.bestLapMs));
  }
  setStandings(players: PlayerSnapshot[], id: string): void {
    const sorted = [...players].sort(
      (a, b) =>
        (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) ||
        a.name.localeCompare(b.name),
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
