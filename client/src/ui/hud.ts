import type { PlayerSnapshot } from "@racing/shared";
import { NUM_CHECKPOINTS } from "@racing/shared";
import { escapeHtml, formatMs } from "../util";

export class Hud {
  private root: HTMLElement;
  private speedEl: HTMLElement;
  private curLapEl: HTMLElement;
  private lastLapEl: HTMLElement;
  private bestLapEl: HTMLElement;
  private lapCountEl: HTMLElement;
  private cpEl: HTMLElement;
  private standingsEl: HTMLElement;
  private offtrackEl: HTMLElement;
  private toastsEl: HTMLElement;

  constructor(parent: HTMLElement, roomName: string, onLeave: () => void) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-panel hud-top-left">
        <div class="hud-room">${escapeHtml(roomName)}</div>
        <div class="hud-lap">LAP 0</div>
        <div class="hud-cp">CP 0/${NUM_CHECKPOINTS}</div>
        <button class="hud-leave">Leave race</button>
      </div>
      <div class="hud-panel hud-timer">
        <div class="hud-cur-lap">--:--.---</div>
        <div class="hud-lap-small">
          <span>LAST <b class="hud-last">--:--.---</b></span>
          <span>BEST <b class="hud-best">--:--.---</b></span>
        </div>
      </div>
      <div class="hud-panel hud-standings">
        <h3>Standings — Best Lap</h3>
        <table><tbody></tbody></table>
      </div>
      <div class="hud-panel hud-speed">
        <span class="speed-value">0</span>
        <span class="speed-unit">KM/H</span>
      </div>
      <div class="offtrack-warn">OFF TRACK</div>
      <div class="toasts"></div>
    `;
    parent.appendChild(this.root);

    this.speedEl = this.root.querySelector(".speed-value")!;
    this.curLapEl = this.root.querySelector(".hud-cur-lap")!;
    this.lastLapEl = this.root.querySelector(".hud-last")!;
    this.bestLapEl = this.root.querySelector(".hud-best")!;
    this.lapCountEl = this.root.querySelector(".hud-lap")!;
    this.cpEl = this.root.querySelector(".hud-cp")!;
    this.standingsEl = this.root.querySelector(".hud-standings tbody")!;
    this.offtrackEl = this.root.querySelector(".offtrack-warn")!;
    this.toastsEl = this.root.querySelector(".toasts")!;

    this.root.querySelector(".hud-leave")!.addEventListener("click", onLeave);
  }

  setSpeed(metersPerSecond: number): void {
    this.speedEl.textContent = String(Math.round(Math.abs(metersPerSecond) * 3.6));
  }

  setCurrentLap(ms: number | null): void {
    this.curLapEl.textContent = formatMs(ms);
  }

  setOffTrack(off: boolean): void {
    this.offtrackEl.classList.toggle("visible", off);
  }

  setMyProgress(p: PlayerSnapshot): void {
    this.lapCountEl.textContent = `LAP ${p.laps}`;
    this.cpEl.textContent = `CP ${p.nextCheckpoint}/${NUM_CHECKPOINTS}`;
    this.lastLapEl.textContent = formatMs(p.lastLapMs);
    this.bestLapEl.textContent = formatMs(p.bestLapMs);
  }

  setStandings(players: PlayerSnapshot[], myId: string): void {
    const sorted = [...players].sort((a, b) => {
      if (a.bestLapMs === null && b.bestLapMs === null) return a.name.localeCompare(b.name);
      if (a.bestLapMs === null) return 1;
      if (b.bestLapMs === null) return -1;
      return a.bestLapMs - b.bestLapMs;
    });
    this.standingsEl.innerHTML = sorted
      .map(
        (p, i) => `
        <tr class="${p.id === myId ? "me" : ""}">
          <td>${i + 1}</td>
          <td>${escapeHtml(p.name)}</td>
          <td class="st-time">${formatMs(p.bestLapMs)}</td>
          <td class="st-time">L${p.laps}</td>
        </tr>`
      )
      .join("");
  }

  toast(text: string, record = false): void {
    const el = document.createElement("div");
    el.className = record ? "toast record" : "toast";
    el.textContent = text;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  dispose(): void {
    this.root.remove();
  }
}
