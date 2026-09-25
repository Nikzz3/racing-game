import * as THREE from "three";
import { JEV_TRACK, JEV_VARIANT, resolveTrack } from "@racing/shared";
import { JevPanel } from "../ui/jev-panel";
import { displayKmh } from "../ui/hud";
import { formatMs } from "../util";
import { animateCar, createCarMesh, disposeCarMesh } from "./car";
import {
  JevLiveRun,
  type JevHoldReason,
  type JevLiveAnswer,
  type RequestJevDecision,
} from "./jev-live-run";
import type { JevRecording } from "./jev-recording";
import {
  createScene,
  disposeWorld,
  followCar,
  snapBehindCar,
  updateSun,
  type SceneBundle,
} from "./scene";
import { buildTrack } from "./trackMesh";

export interface JevLiveCallbacks {
  /** Sends one `jevDrive`; the answer comes back through `JevLiveViewer.receive`. */
  requestDecision: RequestJevDecision;
  /** Watch the finished lap as a Replay; the viewer has already disposed itself. */
  onReplay(recording: JevRecording): void;
  /** Leave for the lobby; the viewer has already disposed itself. */
  onClose(): void;
}

/** The lap time redraws at most this often, like the race HUD's. */
const LAP_TIMER_STEP_MS = 50;

type Status = JevHoldReason | "asking" | null;

const STATUS_TEXT: Record<Exclude<Status, null>, string> = {
  asking: "Asking Jev…",
  busy: "Jev is busy · holding the last input",
  rateLimited: "Jev is rate limited · holding the last input",
  failed: "Jev did not answer · holding the last input",
  timeout: "Jev's answer was lost · holding the last input",
};

/** The lap time as shown: in steps while running, exact once finished, -1 before the line. */
function displayedLapMs(run: JevLiveRun): number {
  const lap = run.lapTimeMs;
  if (lap === null) return -1;
  return run.recording ? lap : Math.floor(lap / LAP_TIMER_STEP_MS) * LAP_TIMER_STEP_MS;
}

/**
 * Watches Jev drive a lap live (a Jev Live Run): the car simulated here in real
 * time on Jev's decisions, followed by the chase camera, with Jev's panel, the lap
 * time and a result card. Not a Room: nothing is sent but `jevDrive`, and the lap
 * never reaches the leaderboard. The run itself lives in `JevLiveRun`.
 */
export class JevLiveViewer {
  private readonly run: JevLiveRun;
  private readonly bundle: SceneBundle;
  private readonly carMesh: THREE.Group;
  private readonly container = document.createElement("div");
  private readonly overlay = document.createElement("div");
  private readonly timeEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly card: HTMLElement;
  private panel: JevPanel | null = null;
  private panelModel = "";
  private animationFrame = 0;
  private running = true;
  private previous = performance.now();
  // What the overlay currently shows, so frames only touch the DOM on a change.
  private shownDecisions = 0;
  private shownLapMs = Number.NaN;
  private shownKmh = -1;
  private shownStatus: Status | undefined;
  private cardShown = false;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: JevLiveCallbacks,
  ) {
    const track = resolveTrack(JEV_TRACK);
    this.run = new JevLiveRun(callbacks.requestDecision, track);
    this.run.paused = document.hidden;
    this.container.style.cssText = "position:absolute;inset:0;";
    parent.append(this.container);
    this.bundle = createScene(this.container, track.samples);
    buildTrack(this.bundle.scene, track);
    this.carMesh = createCarMesh("Jev", "Jev", JEV_VARIANT);
    this.bundle.scene.add(this.carMesh);

    this.overlay.className = "replay-hud";
    this.overlay.innerHTML = `
      <div class="replay-panel">
        <div class="replay-label live-run-label">LIVE</div>
        <div class="replay-name">Jev</div>
        <div class="replay-time"></div>
        <div class="live-run-speed"><span data-live-speed>0</span> km/h</div>
        <div class="live-run-status" aria-live="polite"></div>
        <button class="replay-exit" type="button" data-live-exit>Exit</button>
      </div>
      <div class="live-run-card" hidden>
        <div class="live-run-card-title"></div>
        <div class="live-run-card-time"></div>
        <div class="live-run-card-note"></div>
        <div class="live-run-card-actions">
          <button type="button" data-live-replay>Watch replay</button>
          <button type="button" data-live-again>Drive again</button>
          <button type="button" data-live-exit>Exit</button>
        </div>
      </div>
    `;
    this.timeEl = this.overlay.querySelector(".replay-time")!;
    this.speedEl = this.overlay.querySelector("[data-live-speed]")!;
    this.statusEl = this.overlay.querySelector(".live-run-status")!;
    this.card = this.overlay.querySelector(".live-run-card")!;
    for (const exit of this.overlay.querySelectorAll("[data-live-exit]"))
      exit.addEventListener("click", () => {
        this.dispose();
        this.callbacks.onClose();
      });
    this.overlay.querySelector("[data-live-again]")!.addEventListener("click", () => this.again());
    this.overlay.querySelector("[data-live-replay]")!.addEventListener("click", () => {
      const recording = this.run.recording;
      if (!recording) return;
      this.dispose();
      this.callbacks.onReplay(recording);
    });
    parent.append(this.overlay);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.placeCar();
    this.paint();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  /** Route the server's answer to a `jevDrive`. */
  receive(answer: JevLiveAnswer): void {
    if (this.running) this.run.receive(answer);
  }

  private onResize = (): void => {
    const { camera, renderer } = this.bundle;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /** A hidden tab asks Jev nothing, and its time never reaches the car or the lap. */
  private onVisibility = (): void => {
    this.run.paused = document.hidden;
    if (!document.hidden) this.previous = performance.now();
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const elapsed = Math.max(0, (now - this.previous) / 1000);
    this.previous = now;
    const dt = Math.min(elapsed, 0.05);
    this.run.tick(elapsed);
    const pose = this.run.car.getRenderPose();
    this.carMesh.position.set(pose.x, 0, pose.z);
    this.carMesh.rotation.y = pose.heading;
    animateCar(this.carMesh, pose.speed, this.run.input.steer, dt);
    followCar(this.bundle.camera, pose.x, pose.z, pose.heading, dt);
    updateSun(this.bundle.sun, pose.x, pose.z);
    this.paint();
    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private placeCar(): void {
    const { car } = this.run;
    this.carMesh.position.set(car.x, 0, car.z);
    this.carMesh.rotation.y = car.heading;
    snapBehindCar(this.bundle.camera, car.x, car.z, car.heading);
    updateSun(this.bundle.sun, car.x, car.z);
  }

  /** Bring the overlay up to date; cheap when nothing changed, as on most frames. */
  private paint(): void {
    const run = this.run;
    if (run.decisions !== this.shownDecisions) this.showDecision();
    const lapMs = displayedLapMs(run);
    if (lapMs !== this.shownLapMs) {
      this.shownLapMs = lapMs;
      this.timeEl.textContent = formatMs(lapMs < 0 ? null : lapMs);
    }
    const kmh = displayKmh(run.car.speed);
    if (kmh !== this.shownKmh) {
      this.shownKmh = kmh;
      this.speedEl.textContent = String(kmh);
    }
    const status: Status = run.ended ? null : run.phase === "asking" ? "asking" : run.holding;
    if (status !== this.shownStatus) {
      this.shownStatus = status;
      this.statusEl.textContent = status === null ? "" : STATUS_TEXT[status];
      this.statusEl.hidden = status === null;
    }
    if (run.ended && !this.cardShown) this.showCard();
  }

  /** The panel appears with Jev's first answer, titled with the model that gave it. */
  private showDecision(): void {
    const { latest, decisions } = this.run;
    this.shownDecisions = decisions;
    if (this.panel && latest?.model !== this.panelModel) {
      this.panel.dispose();
      this.panel = null;
    }
    if (!latest) return;
    this.panelModel = latest.model;
    this.panel ??= new JevPanel(this.overlay, latest.model);
    this.panel.update({
      decision: latest.decision,
      seen: latest.seen,
      decisions,
      latencyMs: latest.latencyMs,
    });
  }

  private showCard(): void {
    const { recording, phase, decisions } = this.run;
    this.cardShown = true;
    const [title, note] = recording
      ? ["Lap complete", `${recording.decisions.length} decisions this lap`]
      : phase === "unavailable"
        ? ["Jev is unavailable", "This server cannot reach Jev right now."]
        : decisions === 0
          ? ["Jev did not answer", "Jev could not be reached. Try again in a moment."]
          : ["Jev got lost", "Jev stopped making progress, so the run was called off."];
    this.card.querySelector(".live-run-card-title")!.textContent = title;
    this.card.querySelector(".live-run-card-time")!.textContent = recording
      ? formatMs(recording.timeMs)
      : "";
    this.card.querySelector(".live-run-card-note")!.textContent = note;
    const replay = this.card.querySelector<HTMLButtonElement>("[data-live-replay]")!;
    const again = this.card.querySelector<HTMLButtonElement>("[data-live-again]")!;
    replay.hidden = !recording;
    again.hidden = phase === "unavailable";
    this.card.hidden = false;
    this.card.querySelector<HTMLElement>("button:not([hidden])")!.focus({ preventScroll: true });
  }

  private again(): void {
    this.run.restart();
    this.cardShown = false;
    this.card.hidden = true;
    this.previous = performance.now();
    this.placeCar();
    this.paint();
  }

  dispose(): void {
    if (!this.running) return;
    this.running = false;
    this.run.paused = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.panel?.dispose();
    disposeCarMesh(this.carMesh);
    disposeWorld(this.bundle);
    this.container.remove();
    this.overlay.remove();
  }
}
