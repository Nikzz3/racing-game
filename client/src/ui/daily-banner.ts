import {
  DIFFICULTY_LABELS,
  resolveTrack,
  type DailyBoard,
  type DailyChallenge,
  type ScenePreset,
} from "@racing/shared";
import { escapeHtml as html, formatMs } from "../util";
import { VARIANT_LABELS } from "./variant-labels";

const SCENE_LABELS: Record<ScenePreset, string> = {
  sunset: "Sunset",
  "golden-hour": "Golden hour",
  dusk: "Dusk",
  "foggy-morning": "Foggy morning",
};
/** How many of the day's fastest drivers the banner lists. */
const TOP = 3;

function spec(term: string, value: string): string {
  return `<div><dt>${term}</dt><dd>${value}</dd></div>`;
}

/**
 * The line a driver shares, Wordle-style: the Daily's number and their best,
 * nothing that spoils the challenge. The time is in centiseconds, truncated
 * like formatMs floors. A medal (#169) slots in as one more part.
 */
export function shareText(challenge: DailyChallenge, timeMs: number): string {
  return [`Sunset Ridge Daily #${challenge.number}`, formatMs(timeMs).slice(0, -1)].join(" · ");
}

/**
 * Today's Daily Challenge on the Garage screen: what it is, the top of its
 * Daily Board, the driver's own standing, and a way straight into the Daily
 * Room. Hidden until the server sends a board; older servers never do.
 */
export class DailyBanner {
  private readonly element = document.createElement("section");
  private readonly shareButton: HTMLButtonElement;
  private board: DailyBoard | undefined;
  private driver = "";
  private shareReset: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement, onRace: () => void) {
    this.element.className = "daily";
    this.element.setAttribute("aria-label", "Daily Challenge");
    this.element.hidden = true;
    this.element.innerHTML = `<div class="daily-intro"></div><div class="daily-board"><ol class="daily-top" aria-label="Today's fastest"></ol><p class="daily-standing"><span class="daily-driver"></span><span class="daily-result"></span></p></div><div class="daily-actions"><button type="button" class="daily-share" aria-live="polite">Share</button><button type="button" class="daily-race primary-action" aria-label="Race the Daily">Race the Daily <span>→</span></button></div>`;
    this.find(".daily-race").addEventListener("click", onRace);
    this.shareButton = this.find(".daily-share");
    this.shareButton.addEventListener("click", () => void this.share());
    parent.append(this.element);
  }

  /** Today's board, or undefined from a server that predates the Daily Challenge. */
  setBoard(board: DailyBoard | undefined): void {
    this.board = board;
    this.paint();
  }

  /** The Lobby's driver name, matched against the board for the standing. */
  setDriver(name: string): void {
    this.driver = name;
    this.paint();
  }

  private find<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.element.querySelector<T>(selector)!;
  }

  /** The driver's 1-based place and best time, or null without a lap today. */
  private standing(): { place: number; timeMs: number } | null {
    const entries = this.board?.entries ?? [];
    const index = entries.findIndex((e) => e.name === this.driver);
    return index === -1 ? null : { place: index + 1, timeMs: entries[index].timeMs };
  }

  // Rewrites text and lists only: board updates arrive while a button may hold focus.
  private paint(): void {
    const { board } = this;
    this.element.hidden = !board;
    if (!board) return;
    const { challenge, entries } = board;
    this.find(".daily-intro").innerHTML =
      `<p class="daily-number">DAILY #${challenge.number}</p><h2 class="daily-track">${html(resolveTrack(challenge.track).name)}</h2><dl class="daily-specs">${spec("Difficulty", DIFFICULTY_LABELS[challenge.difficulty])}${spec("Car", VARIANT_LABELS[challenge.variant])}${spec("Scene", SCENE_LABELS[challenge.scene])}</dl>`;
    const top = this.find(".daily-top");
    top.hidden = entries.length === 0;
    top.innerHTML = entries
      .slice(0, TOP)
      .map(
        (e, i) =>
          `<li${e.name === this.driver ? ' class="mine"' : ""}><span class="daily-place">${String(i + 1).padStart(2, "0")}</span><span class="daily-name">${html(e.name)}</span><span class="daily-time">${formatMs(e.timeMs)}</span></li>`,
      )
      .join("");
    const mine = this.standing();
    this.find(".daily-driver").textContent = this.driver;
    this.find(".daily-result").textContent = mine
      ? `P${mine.place} of ${entries.length} · ${formatMs(mine.timeMs)}`
      : "No time yet today";
    this.shareButton.disabled = !mine;
  }

  /** Copies the share line, then briefly confirms on the button itself. */
  private async share(): Promise<void> {
    const mine = this.standing();
    if (!this.board || !mine) return;
    let copied = true;
    try {
      await navigator.clipboard.writeText(shareText(this.board.challenge, mine.timeMs));
    } catch {
      // No clipboard (insecure origin) or permission denied.
      copied = false;
    }
    clearTimeout(this.shareReset);
    this.shareButton.textContent = copied ? "Copied ✓" : "Copy failed";
    this.shareButton.dataset.flash = copied ? "copied" : "failed";
    this.shareReset = setTimeout(() => {
      this.shareButton.textContent = "Share";
      delete this.shareButton.dataset.flash;
    }, 1600);
  }
}
