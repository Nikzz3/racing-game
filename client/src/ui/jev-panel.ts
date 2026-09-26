import { JEV_QUESTIONS, type JevDecision } from "@racing/shared";

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
 * One Choice question as a terminal card: a tag, the question exactly as Jev is
 * asked it, a probability bar per option (the picked one bright) and the
 * confidence TypeSafe reports for the pick.
 */
class ChoiceCard {
  readonly element = document.createElement("div");
  private readonly rows: HTMLElement[];
  private readonly fills: HTMLElement[];
  private readonly confEl: HTMLElement;
  private readonly probabilities: number[];
  private pick = -1;
  private confidence = NaN;

  constructor(name: string, question: string, options: readonly string[]) {
    this.element.className = "jev-card";
    this.element.dataset.question = name;
    this.element.innerHTML = `
      <p class="jev-q"><span class="jev-tag"></span><span class="jev-q-text"></span></p>
      ${options
        .map(
          (option) =>
            `<div class="jev-option" data-option="${option}"><span class="jev-label">${option}</span><span class="jev-track"><span class="jev-fill"></span></span></div>`,
        )
        .join("")}
      <p class="jev-conf">conf <span class="jev-conf-value"></span></p>
    `;
    this.element.querySelector(".jev-tag")!.textContent = name.toUpperCase();
    this.element.querySelector(".jev-q-text")!.textContent = question;
    this.rows = [...this.element.querySelectorAll<HTMLElement>(".jev-option")];
    this.fills = [...this.element.querySelectorAll<HTMLElement>(".jev-fill")];
    this.confEl = this.element.querySelector(".jev-conf-value")!;
    this.probabilities = options.map(() => NaN);
  }

  /** One probability per option, in the constructor's order; `pick` indexes the lit one. */
  update(probabilities: readonly number[], pick: number, confidence: number): void {
    probabilities.forEach((p, i) => {
      if (p === this.probabilities[i]) return;
      this.probabilities[i] = p;
      this.fills[i].style.transform = `scaleX(${p.toFixed(3)})`;
    });
    if (pick !== this.pick) {
      this.pick = pick;
      this.rows.forEach((row, i) => row.toggleAttribute("data-picked", i === pick));
    }
    if (confidence !== this.confidence) {
      this.confidence = confidence;
      this.confEl.textContent = confidence.toFixed(2);
    }
  }
}

/**
 * Shows how Jev decides as it drives, in the style of a terminal: what it was
 * told about the road, then each of its two questions with a bar per option.
 * The pick is the pedal Jev presses (see `jevInput`) and the likeliest of
 * left, nothing and right, laid out as the wheel turns. Shared by the Jev Lap replay and the live run, so both read the same.
 */
export class JevPanel {
  readonly element = document.createElement("section");
  private readonly pedal = new ChoiceCard("pedal", JEV_QUESTIONS.pedal.instructions.question, [
    "brake",
    "accelerate",
  ]);
  private readonly steer = new ChoiceCard("steer", JEV_QUESTIONS.steer.instructions, [
    "left",
    "nothing",
    "right",
  ]);
  private readonly seenEl: HTMLElement;
  private readonly decisionsEl: HTMLElement;
  private readonly latencyEl: HTMLElement;
  private seen: string | null = null;
  private decisions = NaN;
  private latencyMs: number | undefined | null = null;

  constructor(parent: HTMLElement, subtitle: string) {
    this.element.className = "jev-panel";
    this.element.setAttribute("aria-label", "Jev's decisions");
    this.element.innerHTML = `
      <header class="jev-panel-head">
        <span class="jev-panel-name">JEV</span><span class="jev-panel-sub"></span>
        <span class="jev-stats"><span data-jev-decisions>0</span> decisions<span class="jev-latency"></span></span>
      </header>
      <div class="jev-card jev-card-state">
        <p class="jev-q"><span class="jev-tag">STATE</span><span class="jev-seen"></span></p>
      </div>
    `;
    this.element.querySelector(".jev-panel-sub")!.textContent = subtitle;
    this.seenEl = this.element.querySelector(".jev-seen")!;
    this.decisionsEl = this.element.querySelector("[data-jev-decisions]")!;
    this.latencyEl = this.element.querySelector(".jev-latency")!;
    this.element.append(this.pedal.element, this.steer.element);
    parent.append(this.element);
  }

  /** Cheap to call every frame: the DOM is only touched when a value changes. */
  update(view: JevPanelView): void {
    const { accelerate, left, right, pedalConfidence, steerConfidence } = view.decision;
    this.pedal.update([1 - accelerate, accelerate], accelerate < 0.5 ? 0 : 1, pedalConfidence);
    const steer = [left, Math.max(0, 1 - left - right), right];
    // The likeliest option is lit; a tie goes to the earlier one (left, then nothing).
    const pick = steer.indexOf(Math.max(...steer));
    this.steer.update(steer, pick, steerConfidence);
    if (view.seen !== this.seen) {
      this.seen = view.seen;
      this.seenEl.textContent = view.seen;
    }
    if (view.decisions !== this.decisions) {
      this.decisions = view.decisions;
      this.decisionsEl.textContent = String(view.decisions);
    }
    if (view.latencyMs !== this.latencyMs) {
      this.latencyMs = view.latencyMs;
      this.latencyEl.textContent =
        view.latencyMs === undefined ? "" : ` · ${Math.round(view.latencyMs)} ms`;
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
