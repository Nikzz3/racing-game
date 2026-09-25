// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { nearestCenterline, SUNSET_RIDGE, type JevPose } from "@racing/shared";

vi.mock("./scene", () => ({
  createScene: vi.fn(() => ({
    scene: { add: vi.fn() },
    camera: {},
    renderer: { render: vi.fn() },
    sun: {},
  })),
  disposeWorld: vi.fn(),
  updateSun: vi.fn(),
  followCar: vi.fn(),
  snapBehindCar: vi.fn(),
}));
vi.mock("./trackMesh", () => ({ buildTrack: vi.fn() }));
vi.mock("./car", () => ({
  createCarMesh: vi.fn(() => new THREE.Group()),
  animateCar: vi.fn(),
  disposeCarMesh: vi.fn(),
}));

import { createCarMesh, disposeCarMesh } from "./car";
import { disposeWorld } from "./scene";
import { JevLiveViewer, type JevLiveCallbacks } from "./jev-live";
import type { JevLiveAnswer } from "./jev-live-run";

interface Sent {
  pose: JevPose;
  seq: number;
}

let callback: FrameRequestCallback;
let now = 0;
beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
    callback = next;
    return 3;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** Advance the page clock by one 60 Hz frame and draw it. */
function frame(): void {
  now += 1000 / 60;
  callback(now);
}

function open(): { viewer: JevLiveViewer; sent: Sent[]; callbacks: JevLiveCallbacks } {
  const sent: Sent[] = [];
  const callbacks: JevLiveCallbacks = {
    requestDecision: (pose, seq) => sent.push({ pose, seq }),
    onReplay: vi.fn(),
    onClose: vi.fn(),
  };
  return { viewer: new JevLiveViewer(document.body, callbacks), sent, callbacks };
}

function decision(seq: number, accelerate = 1, left = 0.5, model = "jev-1.13.0"): JevLiveAnswer {
  return {
    type: "jevDecision",
    seq,
    accelerate,
    left,
    pedalConfidence: 0.8,
    steerConfidence: 0.2,
    latencyMs: 238,
    model,
  };
}

/** Answers every request like the server's stub: steer at the road ahead, cruise at 30 m/s. */
function stub(viewer: JevLiveViewer, sent: Sent[], answered: number): number {
  for (; answered < sent.length; answered++) {
    const { pose, seq } = sent[answered];
    const { samples } = SUNSET_RIDGE;
    const target = samples[(nearestCenterline(pose.x, pose.z, samples).index + 6) % samples.length];
    const turn = Math.atan2(target.x - pose.x, target.z - pose.z) - pose.heading;
    const bearing = Math.atan2(Math.sin(turn), Math.cos(turn));
    viewer.receive(
      decision(seq, pose.speed < 30 ? 0.9 : 0.2, Math.max(0, Math.min(1, 0.5 + bearing * 2))),
    );
  }
  return answered;
}

const text = (selector: string): string | null =>
  document.querySelector(selector)?.textContent ?? null;

describe("JevLiveViewer", () => {
  it("renders Jev's car and asks Jev before showing the panel", () => {
    const { sent } = open();
    expect(createCarMesh).toHaveBeenCalledWith("Jev", "Jev", "race-future");
    expect(text(".replay-label")).toBe("LIVE");
    expect(text(".live-run-status")).toBe("Asking Jev…");
    expect(text(".replay-time")).toBe("--:--.---");
    frame();
    expect(sent).toHaveLength(1);
    expect(document.querySelector(".jev-panel")).toBeNull();
  });

  it("shows each decision in Jev's panel, titled with the answering model", () => {
    const { viewer, sent } = open();
    frame();
    viewer.receive(decision(sent[0].seq, 1, 0.7));
    frame();
    expect(document.querySelector<HTMLElement>(".live-run-status")!.hidden).toBe(true);
    expect(text(".jev-panel-sub")).toBe("jev-1.13.0");
    expect(text("[data-jev-decisions]")).toBe("1");
    expect(text(".jev-latency")).toContain("238 ms");
    for (let i = 0; i < 30; i++) frame();
    viewer.receive(decision(sent[1].seq));
    frame();
    expect(text("[data-jev-decisions]")).toBe("2");
    expect(Number(text("[data-live-speed]"))).toBeGreaterThan(0);
  });

  it("says when Jev is holding the last input", () => {
    const { viewer, sent } = open();
    frame();
    viewer.receive(decision(sent[0].seq));
    for (let i = 0; i < 7; i++) frame();
    viewer.receive({ type: "jevUnavailable", seq: sent[1].seq, reason: "rateLimited" });
    frame();
    expect(text(".live-run-status")).toContain("rate limited");
  });

  it("asks nothing while the tab is hidden", () => {
    const { viewer, sent } = open();
    // Past the decision interval, so only the hidden tab holds the next request back.
    for (let i = 0; i < 10; i++) frame();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    viewer.receive(decision(sent[0].seq));
    expect(sent).toHaveLength(1);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    frame();
    expect(sent).toHaveLength(2);
  });

  it("finishes the lap with its time, then replays it or drives again", () => {
    const { viewer, sent, callbacks } = open();
    let answered = 0;
    for (let i = 0; i < 90 * 60 && document.querySelector(".live-run-card[hidden]"); i++) {
      frame();
      answered = stub(viewer, sent, answered);
    }
    expect(text(".live-run-card-title")).toBe("Lap complete");
    const time = text(".live-run-card-time")!;
    expect(time).toMatch(/^0:\d\d\.\d{3}$/);
    expect(text(".replay-time")).toBe(time);
    expect(text(".live-run-card-note")).toMatch(/^\d+ decisions this lap$/);
    expect(document.activeElement?.textContent).toBe("Watch replay");

    document.querySelector<HTMLButtonElement>("[data-live-again]")!.click();
    expect(document.querySelector<HTMLElement>(".live-run-card")!.hidden).toBe(true);
    expect(document.querySelector(".jev-panel")).toBeNull();
    expect(text(".live-run-status")).toBe("Asking Jev…");
    expect(text(".replay-time")).toBe("--:--.---");
    const asked = sent.length;
    frame();
    expect(sent).toHaveLength(asked + 1);
    expect(sent.at(-1)!.pose.speed).toBe(0);

    for (let i = 0; i < 90 * 60 && document.querySelector(".live-run-card[hidden]"); i++) {
      frame();
      answered = stub(viewer, sent, answered);
    }
    document.querySelector<HTMLButtonElement>("[data-live-replay]")!.click();
    expect(callbacks.onReplay).toHaveBeenCalledOnce();
    const recording = vi.mocked(callbacks.onReplay).mock.calls[0][0];
    expect(recording.model).toBe("jev-1.13.0");
    expect(recording.frames[0][0]).toBe(0);
    expect(recording.frames.at(-1)![0]).toBe(recording.timeMs);
    expect(document.querySelector(".replay-hud")).toBeNull();
    expect(disposeWorld).toHaveBeenCalledOnce();
  });

  it("ends for good when the server cannot reach Jev", () => {
    const { viewer, sent } = open();
    frame();
    viewer.receive({ type: "jevUnavailable", seq: sent[0].seq, reason: "disabled" });
    frame();
    expect(text(".live-run-card-title")).toBe("Jev is unavailable");
    expect(document.querySelector<HTMLElement>("[data-live-replay]")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-live-again]")!.hidden).toBe(true);
    expect(document.activeElement?.textContent).toBe("Exit");
  });

  it("exits to the lobby, releasing everything once and asking nothing more", () => {
    const { viewer, sent, callbacks } = open();
    frame();
    viewer.receive(decision(sent[0].seq));
    frame();
    document.querySelector<HTMLButtonElement>(".replay-exit")!.click();
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    viewer.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(disposeCarMesh).toHaveBeenCalledOnce();
    expect(disposeWorld).toHaveBeenCalledOnce();
    expect(document.querySelector(".replay-hud")).toBeNull();
    expect(document.querySelector(".jev-panel")).toBeNull();
    const asked = sent.length;
    viewer.receive(decision(sent.at(-1)!.seq));
    expect(sent).toHaveLength(asked);
  });
});
