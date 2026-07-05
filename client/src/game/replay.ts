import * as THREE from "three";
import type { ReplayFrame } from "@racing/shared";
import { formatMs, escapeHtml } from "../util";
import { animateCar, createCarMesh } from "./car";
import { createScene, updateSun, followCar, snapBehindCar, type SceneBundle } from "./scene";
import { SUNSET_RIDGE } from "@racing/shared";
import { buildTrack } from "./trackMesh";

const FINISH_HOLD_MS = 1500;

/** Plays back a recorded lap in its own 3D scene with a chase camera. */
export class ReplayViewer {
  private bundle: SceneBundle;
  private carMesh: THREE.Group;
  private container: HTMLElement;
  private overlay: HTMLElement;
  private timeEl: HTMLElement;
  private finishedEl: HTMLElement;
  private running = true;
  private lastFrame = performance.now();
  private playStart = performance.now();
  private index = 0;
  private finishedAt: number | null = null;

  private onResize = () => {
    const { camera, renderer } = this.bundle;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(
    parent: HTMLElement,
    private name: string,
    private timeMs: number,
    private frames: ReplayFrame[],
    private onClose: () => void
  ) {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;inset:0;";
    parent.appendChild(this.container);

    this.bundle = createScene(this.container);
    buildTrack(this.bundle.scene, SUNSET_RIDGE.samples);

    this.carMesh = createCarMesh(name, name);
    this.bundle.scene.add(this.carMesh);

    this.overlay = document.createElement("div");
    this.overlay.className = "replay-hud";
    this.overlay.innerHTML = `
      <div class="replay-panel">
        <div class="replay-label">REPLAY</div>
        <div class="replay-name">${escapeHtml(name)}</div>
        <div class="replay-time">--:--.--- / ${formatMs(timeMs)}</div>
        <button class="replay-exit">Exit replay</button>
      </div>
      <div class="replay-finished" hidden>Lap complete</div>
    `;
    parent.appendChild(this.overlay);
    this.timeEl = this.overlay.querySelector(".replay-time")!;
    this.finishedEl = this.overlay.querySelector(".replay-finished")!;
    this.overlay.querySelector(".replay-exit")!.addEventListener("click", () => {
      this.dispose();
      this.onClose();
    });

    window.addEventListener("resize", this.onResize);

    this.applyFrameAt(0);
    this.snapCameraBehindCar();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    const lastT = this.frames[this.frames.length - 1][0];
    const t = now - this.playStart;

    if (t >= lastT) {
      // Hold the final pose, then loop after a short pause.
      this.applyFrameAt(lastT, dt);
      this.timeEl.textContent = `${formatMs(this.timeMs)} / ${formatMs(this.timeMs)}`;
      if (this.finishedAt === null) {
        this.finishedAt = now;
        this.finishedEl.hidden = false;
      } else if (now - this.finishedAt >= FINISH_HOLD_MS) {
        this.restart(now);
      }
    } else {
      this.applyFrameAt(t, dt);
      this.timeEl.textContent = `${formatMs(t)} / ${formatMs(this.timeMs)}`;
    }

    this.updateCamera(dt);
    updateSun(this.bundle.sun, this.carMesh.position.x, this.carMesh.position.z);
    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    requestAnimationFrame(this.frame);
  };

  private restart(now: number): void {
    this.playStart = now;
    this.index = 0;
    this.finishedAt = null;
    this.finishedEl.hidden = true;
    this.applyFrameAt(0);
    this.snapCameraBehindCar();
  }

  /** Interpolates the recorded pose at time `t` and applies it to the car mesh. */
  private applyFrameAt(t: number, dt = 0): void {
    const frames = this.frames;
    while (this.index < frames.length - 2 && frames[this.index + 1][0] <= t) {
      this.index++;
    }
    const f0 = frames[this.index];
    const f1 = frames[Math.min(this.index + 1, frames.length - 1)];
    const span = f1[0] - f0[0];
    const a = span > 0 ? Math.max(0, Math.min(1, (t - f0[0]) / span)) : 0;

    const x = f0[1] + (f1[1] - f0[1]) * a;
    const z = f0[2] + (f1[2] - f0[2]) * a;
    const speed = f0[4] + (f1[4] - f0[4]) * a;

    // Shortest-arc heading interpolation.
    let d = (f1[3] - f0[3]) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    const heading = f0[3] + d * a;

    this.carMesh.position.set(x, 0, z);
    this.carMesh.rotation.y = heading;
    animateCar(this.carMesh, speed, 0, dt);
  }

  private updateCamera(dt: number): void {
    const { x, z } = this.carMesh.position;
    followCar(this.bundle.camera, x, z, this.carMesh.rotation.y, dt);
  }

  private snapCameraBehindCar(): void {
    const { x, z } = this.carMesh.position;
    snapBehindCar(this.bundle.camera, x, z, this.carMesh.rotation.y);
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener("resize", this.onResize);
    this.bundle.renderer.dispose();
    this.container.remove();
    this.overlay.remove();
  }
}
