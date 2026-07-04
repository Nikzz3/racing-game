import * as THREE from "three";
import {
  DEFAULT_DIFFICULTY,
  type Difficulty,
  TRACK_DIVISIONS,
  TRACK_SAMPLES,
  type PlayerSnapshot,
  type ServerMessage,
} from "@racing/shared";
import type { Net } from "../net";
import { Hud } from "../ui/hud";
import { formatMs } from "../util";
import { animateCar, createCarMesh } from "./car";
import { Input, type CarInput } from "./input";
import { TouchControls } from "./touch";
import { CarPhysics } from "./physics";
import { RemotePlayers } from "./remote";
import { createScene, updateSun, followCar, snapBehindCar, type SceneBundle } from "./scene";
import { buildTrack } from "./trackMesh";

const SEND_INTERVAL_MS = 50;
/** Spawn just before the start/finish line so crossing it starts the lap timer. */
const SPAWN_SAMPLE = TRACK_DIVISIONS - 14;

export class Game {
  private bundle: SceneBundle;
  private hud: Hud;
  private input: Input;
  private touch: TouchControls;
  private car: CarPhysics;
  private carMesh: THREE.Group;
  private remote: RemotePlayers;
  private sendTimer: ReturnType<typeof setInterval>;
  private running = true;
  private lastFrame = performance.now();
  private container: HTMLElement;

  // Current-lap clock derived from server snapshots (no clock sync needed).
  private curLapBaseMs: number | null = null;
  private curLapReceivedAt = 0;

  private autopilot = false;

  private onResize = () => {
    const { camera, renderer } = this.bundle;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(
    parent: HTMLElement,
    private net: Net,
    private myId: string,
    roomName: string,
    onLeave: () => void,
    difficulty: Difficulty = DEFAULT_DIFFICULTY
  ) {
    this.car = new CarPhysics(difficulty);
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;inset:0;";
    parent.appendChild(this.container);

    this.bundle = createScene(this.container);
    buildTrack(this.bundle.scene);

    this.car.spawnAtSample(SPAWN_SAMPLE, (Math.random() - 0.5) * 7);
    this.carMesh = createCarMesh(myId);
    this.bundle.scene.add(this.carMesh);

    this.remote = new RemotePlayers(this.bundle.scene, myId);
    this.hud = new Hud(parent, roomName, onLeave);
    this.touch = new TouchControls(parent);
    this.input = new Input(this.touch);
    this.input.onRespawn = () => this.respawn();
    this.input.attach();
    window.addEventListener("resize", this.onResize);

    this.snapCameraBehindCar();

    this.sendTimer = setInterval(() => {
      this.net.send({
        type: "state",
        x: this.car.x,
        y: 0,
        z: this.car.z,
        rot: this.car.heading,
        speed: this.car.speed,
      });
    }, SEND_INTERVAL_MS);

    // Debug/testing hook: drives the car around the track automatically.
    (window as unknown as Record<string, unknown>).__autopilot = (on: boolean) => {
      this.autopilot = on;
    };

    requestAnimationFrame(this.frame);
  }

  onMessage(msg: ServerMessage): void {
    if (msg.type === "snapshot") {
      this.remote.onSnapshot(msg.players);
      this.hud.setStandings(msg.players, this.myId);
      const me = msg.players.find((p) => p.id === this.myId);
      if (me) this.applyMyProgress(me, msg.t);
    } else if (msg.type === "lap") {
      this.onLap(msg);
    }
  }

  private applyMyProgress(me: PlayerSnapshot, serverT: number): void {
    this.hud.setMyProgress(me);
    this.curLapBaseMs = me.lapStartT === null ? null : serverT - me.lapStartT;
    this.curLapReceivedAt = performance.now();
  }

  private onLap(msg: Extract<ServerMessage, { type: "lap" }>): void {
    if (msg.playerId === this.myId) {
      const suffix = msg.isTrackRecord
        ? "  TRACK RECORD!"
        : msg.isPersonalBest
          ? "  Personal best!"
          : "";
      this.hud.toast(`Lap ${msg.laps} — ${formatMs(msg.lapTimeMs)}${suffix}`, msg.isTrackRecord);
    } else if (msg.isTrackRecord) {
      this.hud.toast(`${msg.name} set a track record: ${formatMs(msg.lapTimeMs)}`, true);
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    const input = this.autopilot ? this.autopilotInput() : this.input.read(dt);
    this.car.update(dt, input);

    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = this.car.heading;
    animateCar(this.carMesh, this.car.speed, input.steer, dt);

    this.remote.update(dt);
    this.updateCamera(dt);
    updateSun(this.bundle.sun, this.car.x, this.car.z);

    this.hud.setSpeed(this.car.speed);
    this.hud.setOffTrack(!this.car.onTrack && Math.abs(this.car.speed) > 1);
    this.hud.setCurrentLap(
      this.curLapBaseMs === null
        ? null
        : this.curLapBaseMs + (performance.now() - this.curLapReceivedAt)
    );

    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    requestAnimationFrame(this.frame);
  };

  private updateCamera(dt: number): void {
    followCar(this.bundle.camera, this.car.x, this.car.z, this.car.heading, dt);
  }

  private snapCameraBehindCar(): void {
    snapBehindCar(this.bundle.camera, this.car.x, this.car.z, this.car.heading);
  }

  /**
   * Respawn: teleport own car to spawn and abandon the in-progress lap. Server is
   * authoritative for checkpoint progress, so we both reset locally (instant feel)
   * and ask the server to rewind timing — otherwise the server would still expect
   * a mid-track checkpoint and the lap clock would keep ticking through the teleport.
   */
  private respawn(): void {
    this.net.send({ type: "respawn" });
    this.car.spawnAtSample(SPAWN_SAMPLE, (Math.random() - 0.5) * 7);
    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = this.car.heading;
    this.snapCameraBehindCar();
    this.curLapBaseMs = null;
    this.hud.setCurrentLap(null);
  }

  private autopilotInput(): CarInput {
    const n = TRACK_SAMPLES.length;
    const target = TRACK_SAMPLES[(this.car.centerIndex + 12) % n];
    const desired = Math.atan2(target.x - this.car.x, target.z - this.car.z);
    let diff = (desired - this.car.heading) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return {
      steer: Math.max(-1, Math.min(1, diff * 2.5)),
      throttle: Math.abs(diff) > 0.5 && this.car.speed > 18 ? 0 : 1,
      brake: Math.abs(diff) > 0.9 && this.car.speed > 12 ? 1 : 0,
    };
  }

  dispose(): void {
    this.running = false;
    clearInterval(this.sendTimer);
    this.input.detach();
    this.touch.dispose();
    window.removeEventListener("resize", this.onResize);
    this.remote.dispose();
    this.hud.dispose();
    this.bundle.renderer.dispose();
    this.container.remove();
    delete (window as unknown as Record<string, unknown>).__autopilot;
  }
}
