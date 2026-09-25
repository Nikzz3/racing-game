// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { JevPanel } from "./jev-panel";

let parent: HTMLElement;
const q = (selector: string) => parent.querySelector<HTMLElement>(selector)!;

beforeEach(() => {
  document.body.innerHTML = "";
  parent = document.createElement("div");
  document.body.append(parent);
});

describe("JevPanel", () => {
  it("shows the pedal Jev picked, the steering side and what it saw", () => {
    const panel = new JevPanel(parent, "jev-1.13.0");
    panel.update({
      decision: { accelerate: 0.2, left: 0.9, pedalConfidence: 0.52, steerConfidence: 0.81 },
      seen: "the sharpest bend in the next 190 m turns 63° to the left within 40 m, starting 70 m ahead",
      decisions: 12,
      latencyMs: 236.4,
    });
    expect(q(".jev-panel-sub").textContent).toBe("jev-1.13.0");
    expect(q(".jev-pedal-pick").textContent).toBe("Brake 80%");
    expect(q(".jev-pedal-pick").dataset.pick).toBe("brake");
    expect(q(".jev-pedal-fill").style.transform).toBe("scaleX(0.2)");
    expect(q(".jev-steer-pick").textContent).toBe("Left 90%");
    expect(q(".jev-steer-needle").style.transform).toBe("translateX(10.0%)");
    expect(q(".jev-seen").textContent).toMatch(/^The sharpest bend/);
    expect(q("[data-jev-decisions]").textContent).toBe("12");
    expect(q(".jev-latency").textContent).toBe(" · 236 ms");
  });

  it("omits latency for a recorded lap and removes itself on dispose", () => {
    const panel = new JevPanel(parent, "recorded");
    panel.update({
      decision: { accelerate: 0.9, left: 0.3, pedalConfidence: 0.7, steerConfidence: 0.3 },
      seen: "the road is straight",
      decisions: 1,
    });
    expect(q(".jev-pedal-pick").textContent).toBe("Accelerate 90%");
    expect(q(".jev-steer-pick").textContent).toBe("Right 70%");
    expect(q(".jev-latency").textContent).toBe("");
    panel.dispose();
    expect(parent.querySelector(".jev-panel")).toBeNull();
  });
});
