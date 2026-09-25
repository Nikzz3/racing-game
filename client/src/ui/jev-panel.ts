import type { JevDecision } from "@racing/shared";

export interface JevPanelView {
  decision: JevDecision;
  /** What Jev was told about the road ahead (`bend_ahead` of the pose it judged). */
  seen: string;
  /** Decisions made so far in this lap. */
  decisions: number;
  /** Round trip of the latest decision; absent for a recorded lap. */
  latencyMs?: number;
}

/**
 * Shows Jev's two judgments as it drives: the pedal as P(accelerate) against
 * brake, and the steering needle at P(left) − P(right). Shared by the Jev Lap
 * replay and the live run, so both read the same.
 */
export class JevPanel {
  readonly element = document.createElement("section");
  private readonly pedalFill: HTMLElement;
  private readonly pedalPick: HTMLElement;
  private readonly steerNeedle: HTMLElement;
  private readonly steerPick: HTMLElement;
  private readonly seenEl: HTMLElement;
  private readonly decisionsEl: HTMLElement;
  private readonly latencyEl: HTMLElement;
  private last: JevPanelView | null = null;

  constructor(parent: HTMLElement, subtitle: string) {
    this.element.className = "jev-panel";
    this.element.setAttribute("aria-label", "Jev's decisions");
    this.element.innerHTML = `
      <header class="jev-panel-head"><span class="jev-panel-name">JEV</span><span class="jev-panel-sub"></span></header>
      <div class="jev-row">
        <span class="jev-row-label">Pedal</span>
        <div class="jev-bar jev-pedal"><div class="jev-pedal-fill"></div></div>
        <div class="jev-bar-ends"><span>Brake</span><span>Accelerate</span></div>
        <span class="jev-pick jev-pedal-pick"></span>
      </div>
      <div class="jev-row">
        <span class="jev-row-label">Steering</span>
        <div class="jev-bar jev-steer"><div class="jev-steer-needle"></div></div>
        <div class="jev-bar-ends"><span>Left</span><span>Right</span></div>
        <span class="jev-pick jev-steer-pick"></span>
      </div>
      <p class="jev-seen"></p>
      <footer class="jev-stats"><span data-jev-decisions>0</span> decisions<span class="jev-latency"></span></footer>
    `;
    this.element.querySelector(".jev-panel-sub")!.textContent = subtitle;
    this.pedalFill = this.element.querySelector(".jev-pedal-fill")!;
    this.pedalPick = this.element.querySelector(".jev-pedal-pick")!;
    this.steerNeedle = this.element.querySelector(".jev-steer-needle")!;
    this.steerPick = this.element.querySelector(".jev-steer-pick")!;
    this.seenEl = this.element.querySelector(".jev-seen")!;
    this.decisionsEl = this.element.querySelector("[data-jev-decisions]")!;
    this.latencyEl = this.element.querySelector(".jev-latency")!;
    parent.append(this.element);
  }

  /** Cheap to call every frame: the DOM is only touched when a value changes. */
  update(view: JevPanelView): void {
    const last = this.last;
    const { accelerate, left } = view.decision;
    if (last?.decision.accelerate !== accelerate) {
      this.pedalFill.style.transform = `scaleX(${accelerate})`;
      const brake = accelerate < 0.5;
      this.pedalPick.textContent = `${brake ? "Brake" : "Accelerate"} ${percent(brake ? 1 - accelerate : accelerate)}`;
      this.pedalPick.dataset.pick = brake ? "brake" : "accelerate";
    }
    if (last?.decision.left !== left) {
      // Needle at the steering amount: full left at 0%, straight at 50%, full right at 100%.
      this.steerNeedle.style.transform = `translateX(${((1 - left) * 100).toFixed(1)}%)`;
      const goLeft = left >= 0.5;
      this.steerPick.textContent = `${goLeft ? "Left" : "Right"} ${percent(goLeft ? left : 1 - left)}`;
    }
    if (last?.seen !== view.seen) this.seenEl.textContent = capitalize(view.seen);
    if (last?.decisions !== view.decisions) this.decisionsEl.textContent = String(view.decisions);
    if (last?.latencyMs !== view.latencyMs)
      this.latencyEl.textContent =
        view.latencyMs === undefined ? "" : ` · ${Math.round(view.latencyMs)} ms`;
    this.last = { ...view, decision: { ...view.decision } };
  }

  dispose(): void {
    this.element.remove();
  }
}

const percent = (p: number): string => `${Math.round(p * 100)}%`;
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
