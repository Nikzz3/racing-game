// @vitest-environment jsdom
import { JEV_QUESTIONS } from "@racing/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { JevPanel, type JevPanelView } from "./jev-panel";

let parent: HTMLElement;
const q = (selector: string) => parent.querySelector<HTMLElement>(selector)!;
const card = (question: string) => q(`.jev-card[data-question="${question}"]`);
const row = (question: string, option: string) =>
  card(question).querySelector<HTMLElement>(`.jev-option[data-option="${option}"]`)!;
const bar = (question: string, option: string) =>
  row(question, option).querySelector<HTMLElement>(".jev-fill")!.style.transform;
const picked = (question: string) =>
  [...card(question).querySelectorAll<HTMLElement>(".jev-option[data-picked]")].map(
    (el) => el.dataset.option,
  );
const conf = (question: string) => card(question).querySelector(".jev-conf")!.textContent;

const view = (overrides: Partial<JevPanelView> = {}): JevPanelView => ({
  decision: {
    accelerate: 0.2,
    left: 0.9,
    pedalConfidence: 0.52,
    steerConfidence: 0.81,
  },
  seen: "the sharpest bend in the next 190 m turns 63° to the left within 40 m, starting 70 m ahead",
  decisions: 12,
  latencyMs: 236.4,
  ...overrides,
});

beforeEach(() => {
  document.body.innerHTML = "";
  parent = document.createElement("div");
  document.body.append(parent);
});

describe("JevPanel", () => {
  it("shows both questions exactly as Jev is asked them, one row per option", () => {
    new JevPanel(parent, "jev-1.13.0");
    expect(card("pedal").querySelector(".jev-tag")!.textContent).toBe("PEDAL");
    expect(card("pedal").querySelector(".jev-q-text")!.textContent).toBe(
      JEV_QUESTIONS.pedal.instructions.question,
    );
    expect(card("steer").querySelector(".jev-tag")!.textContent).toBe("STEER");
    expect(card("steer").querySelector(".jev-q-text")!.textContent).toBe(
      JEV_QUESTIONS.steer.instructions,
    );
    const options = (question: string) =>
      [...card(question).querySelectorAll(".jev-label")].map((el) => el.textContent);
    expect(options("pedal")).toEqual(["brake", "accelerate"]);
    expect(options("steer")).toEqual(["left", "right"]);
  });

  it("draws each option's probability, lights the pick and shows the confidence", () => {
    const panel = new JevPanel(parent, "jev-1.13.0");
    panel.update(view());
    expect(bar("pedal", "brake")).toBe("scaleX(0.800)");
    expect(bar("pedal", "accelerate")).toBe("scaleX(0.200)");
    expect(picked("pedal")).toEqual(["brake"]);
    expect(conf("pedal")).toBe("conf 0.52");
    expect(bar("steer", "left")).toBe("scaleX(0.900)");
    expect(bar("steer", "right")).toBe("scaleX(0.100)");
    expect(picked("steer")).toEqual(["left"]);
    expect(conf("steer")).toBe("conf 0.81");

    // An even pedal accelerates and an even wheel reads as left, as in jevInput.
    panel.update(
      view({
        decision: {
          accelerate: 0.5,
          left: 0.5,
          pedalConfidence: 0.1,
          steerConfidence: 0.049,
        },
      }),
    );
    expect(picked("pedal")).toEqual(["accelerate"]);
    expect(picked("steer")).toEqual(["left"]);
    expect(conf("steer")).toBe("conf 0.05");
    panel.update(
      view({
        decision: {
          accelerate: 0.97,
          left: 0.3,
          pedalConfidence: 0.94,
          steerConfidence: 0.4,
        },
      }),
    );
    expect(picked("pedal")).toEqual(["accelerate"]);
    expect(bar("pedal", "accelerate")).toBe("scaleX(0.970)");
    expect(picked("steer")).toEqual(["right"]);
  });

  it("heads the box with the model, the decision count, the latency and what Jev saw", () => {
    const panel = new JevPanel(parent, "jev-1.13.0");
    panel.update(view());
    expect(q(".jev-panel-sub").textContent).toBe("jev-1.13.0");
    expect(q("[data-jev-decisions]").textContent).toBe("12");
    expect(q(".jev-stats").textContent).toBe("12 decisions · 236 ms");
    expect(q(".jev-card-state .jev-tag").textContent).toBe("STATE");
    expect(q(".jev-seen").textContent).toBe(view().seen);
  });

  it("omits latency for a recorded lap and removes itself on dispose", () => {
    const panel = new JevPanel(parent, "recorded");
    panel.update(view({ latencyMs: undefined, decisions: 3 }));
    expect(q(".jev-stats").textContent).toBe("3 decisions");
    expect(q(".jev-latency").textContent).toBe("");
    panel.dispose();
    expect(parent.querySelector(".jev-panel")).toBeNull();
  });

  it("only touches the DOM for values that changed", () => {
    const panel = new JevPanel(parent, "jev-1.13.0");
    panel.update(view());
    const observer = new MutationObserver(() => {});
    observer.observe(parent, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    panel.update(view());
    expect(observer.takeRecords()).toEqual([]);

    panel.update(view({ decisions: 13 }));
    const targets = observer.takeRecords().map((record) => record.target);
    expect(targets).toEqual([q("[data-jev-decisions]")]);
    observer.disconnect();
  });
});
