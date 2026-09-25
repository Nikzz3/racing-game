import * as THREE from "three";
import {
  jevDrivingState,
  resolveTrack,
  type ReplayFrame,
  type Track,
  type TrackSlug,
  type Variant,
} from "@racing/shared";
import { JevPanel } from "../ui/jev-panel";
import { formatMs } from "../util";
import { animateCar, createCarMesh, disposeCarMesh } from "./car";
import { decisionAt, type JevRecording } from "./jev-recording";
import {
  createScene,
  disposeWorld,
  updateSun,
  followCar,
  snapBehindCar,
  type SceneBundle,
} from "./scene";
import { buildTrack } from "./trackMesh";
import { interpolatePose } from "./pose-interpolation";

const FINISH_HOLD_MS = 1500;

/**
 * Jev's decisions beside the replay of a lap Jev drove: the decision in force
 * and what Jev was told about the road ahead when it made it.
 */
class JevReplayPanel {
  private panel: JevPanel | null = null;
  private shown = 0;
  /** What Jev saw, per decision index: described once from the pose it judged. */
  private readonly seen: string[] = [];

  constructor(
    private readonly parent: HTMLElement,
    private readonly recording: JevRecording,
    private readonly track: Track,
  ) {}

  /** A fresh panel for a new loop, empty until Jev's first decision. */
  restart(): void {
    this.panel?.dispose();
    this.panel = new JevPanel(this.parent, this.recording.model);
    this.shown = 0;
  }

  show(time: number): void {
    const current = decisionAt(this.recording.decisions, time);
    if (!current || current.count === this.shown || !this.panel) return;
    const index = current.count - 1;
    // A live run recorded what Jev was told; the Jev Lap's is rebuilt from its frames.
    this.seen[index] ??=
      this.recording.seen?.[index] ??
      jevDrivingState(interpolatePose(this.recording.frames, current.madeAt), this.track)
        .bend_ahead;
    this.panel.update({
      decision: current.decision,
      seen: this.seen[index],
      decisions: current.count,
    });
    this.shown = current.count;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }
}

/** Owns a replay scene, its playback clock and all associated browser resources. */
export class ReplayViewer {
  private readonly bundle: SceneBundle;
  private readonly carMesh: THREE.Group;
  private readonly container = document.createElement("div");
  private readonly overlay = document.createElement("div");
  private readonly timeEl: HTMLElement;
  private readonly finishedEl: HTMLElement;
  private readonly jev: JevReplayPanel | null;
  private animationFrame = 0;
  private running = true;
  private lastFrame: number;
  private playStart: number;
  private finishedAt: number | null = null;

  constructor(
    parent: HTMLElement,
    name: string,
    trackSlug: TrackSlug,
    private readonly timeMs: number,
    private readonly frames: ReplayFrame[],
    variant: Variant | undefined,
    private readonly onClose: () => void,
    /** A lap Jev drove: shows Jev's decisions alongside, in step with playback. */
    jev?: JevRecording,
  ) {
    // Validate before allocating a renderer or attaching any DOM nodes.
    if (frames.length === 0) throw new Error("ReplayViewer: frames must not be empty");
    this.lastFrame = this.playStart = performance.now();
    this.container.style.cssText = "position:absolute;inset:0;";
    parent.append(this.container);
    const track = resolveTrack(trackSlug);
    this.bundle = createScene(this.container, track.samples);
    buildTrack(this.bundle.scene, track);
    this.carMesh = createCarMesh(name, name, variant);
    this.bundle.scene.add(this.carMesh);

    this.overlay.className = "replay-hud";
    this.overlay.innerHTML = `
      <div class="replay-panel">
        <div class="replay-label">REPLAY</div>
        <div class="replay-name"></div>
        <div class="replay-time"></div>
        <button class="replay-exit" type="button">Exit replay</button>
      </div>
      <div class="replay-finished" hidden>Lap complete</div>
    `;
    this.overlay.querySelector<HTMLElement>(".replay-name")!.textContent = name;
    this.timeEl = this.overlay.querySelector<HTMLElement>(".replay-time")!;
    this.timeEl.textContent = `--:--.--- / ${formatMs(timeMs)}`;
    this.finishedEl = this.overlay.querySelector<HTMLElement>(".replay-finished")!;
    this.overlay.querySelector(".replay-exit")!.addEventListener("click", () => {
      this.dispose();
      this.onClose();
    });
    parent.append(this.overlay);
    this.jev = jev ? new JevReplayPanel(this.overlay, jev, track) : null;
    window.addEventListener("resize", this.onResize);
    this.restart(this.playStart);
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  private onResize = (): void => {
    const { camera, renderer } = this.bundle;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.max(0, Math.min((now - this.lastFrame) / 1000, 0.05));
    this.lastFrame = now;
    const finalTime = this.frames[this.frames.length - 1][0];
    const elapsed = now - this.playStart;
    if (elapsed >= finalTime) {
      this.applyFrameAt(finalTime, dt);
      this.timeEl.textContent = `${formatMs(this.timeMs)} / ${formatMs(this.timeMs)}`;
      if (this.finishedAt === null) {
        this.finishedAt = now;
        this.finishedEl.hidden = false;
      } else if (now - this.finishedAt >= FINISH_HOLD_MS) {
        this.restart(now);
      }
    } else {
      this.applyFrameAt(elapsed, dt);
      this.timeEl.textContent = `${formatMs(elapsed)} / ${formatMs(this.timeMs)}`;
    }
    const { x, z } = this.carMesh.position;
    followCar(this.bundle.camera, x, z, this.carMesh.rotation.y, dt);
    updateSun(this.bundle.sun, x, z);
    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private restart(now: number): void {
    this.playStart = now;
    this.finishedAt = null;
    this.finishedEl.hidden = true;
    this.jev?.restart();
    this.applyFrameAt(0, 0);
    const { x, z } = this.carMesh.position;
    snapBehindCar(this.bundle.camera, x, z, this.carMesh.rotation.y);
  }

  private applyFrameAt(time: number, dt: number): void {
    const pose = interpolatePose(this.frames, time);
    this.carMesh.position.set(pose.x, 0, pose.z);
    this.carMesh.rotation.y = pose.heading;
    animateCar(this.carMesh, pose.speed, 0, dt);
    this.jev?.show(time);
  }

  dispose(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    this.jev?.dispose();
    disposeCarMesh(this.carMesh);
    disposeWorld(this.bundle);
    this.container.remove();
    this.overlay.remove();
  }
}
