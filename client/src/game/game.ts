import * as THREE from "three";
import {
  CHECKPOINT_RADIUS,
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  nearestCenterline,
  resolveTrack,
  type Difficulty,
  type PlayerSnapshot,
  type ReplayFrame,
  type ServerMessage,
  type Track,
  type Variant,
} from "@racing/shared";
import type { Net } from "../net";
import type { ArmedPacer } from "../ui/lobby";
import { Hud } from "../ui/hud";
import { formatMs } from "../util";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import { Input, type CarInput } from "./input";
import { TouchControls } from "./touch";
import { CarPhysics } from "./physics";
import { RemotePlayers } from "./remote";
import { PacerOverlay, pacerCheckpointTimes, pacerDelta } from "./pacer";
import {
  createScene,
  disposeWorld,
  followCar,
  snapBehindCar,
  updateSun,
  type SceneBundle,
} from "./scene";
import { buildTrack } from "./trackMesh";
import { checkpointMissed } from "./checkpoint-miss";
import { E2eSeam } from "./e2e-seam";
import { autopilotInput } from "./harness";

const SEND_MS = 50;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0 };

declare global {
  interface Window {
    __autopilot?: (enabled: boolean) => void;
  }
}

export class Game {
  private readonly track: Track;
  private readonly car: CarPhysics;
  private readonly carMesh: THREE.Group;
  private readonly bundle: SceneBundle;
  private readonly hud: Hud;
  private readonly remote: RemotePlayers;
  private readonly touch: TouchControls;
  private readonly input: Input;
  private readonly container = document.createElement("div");
  private readonly checkpoints: number[];
  private readonly sendTimer: ReturnType<typeof setInterval>;
  private seam: E2eSeam | null = null;
  private pacer: PacerOverlay | null = null;
  private pacerTimes: (number | null)[] = [];
  private nextCheckpoint = 0;
  private localLapStart: number | null = null;
  private progress: PlayerSnapshot | null = null;
  private clock: { elapsed: number; received: number } | null = null;
  private previous = performance.now();
  private animation = 0;
  private disposed = false;
  private autopilot = false;

  constructor(
    parent: HTMLElement,
    private readonly net: Net,
    private readonly myId: string,
    roomName: string,
    onLeave: () => void,
    difficulty: Difficulty = DEFAULT_DIFFICULTY,
    trackSlug = DEFAULT_TRACK_SLUG,
    armedPacer?: ArmedPacer | null,
    private readonly variant?: Variant,
  ) {
    this.track = resolveTrack(trackSlug);
    this.checkpoints = this.track.checkpoints.map(
      (cp) => nearestCenterline(cp.x, cp.z, this.track.samples).index,
    );
    this.car = new CarPhysics(difficulty, this.track.samples);
    this.container.className = "race-viewport";
    parent.append(this.container);
    this.bundle = createScene(this.container, this.track.samples);
    buildTrack(this.bundle.scene, this.track);
    this.remote = new RemotePlayers(this.bundle.scene, myId);
    this.carMesh = createCarMesh(myId, undefined, variant);
    this.bundle.scene.add(this.carMesh);
    this.hud = new Hud(
      parent,
      roomName,
      onLeave,
      this.track.checkpoints.length,
      () => this.respawn(),
      this.track,
    );
    this.touch = new TouchControls(parent);
    this.input = new Input(this.touch);
    this.input.onRespawn = () => this.respawn();
    this.input.attach();
    if (armedPacer) {
      this.pacer = new PacerOverlay(this.bundle.scene, armedPacer.name);
      this.hud.showPacerChip(() => this.dismissPacer(), armedPacer.name);
    }
    this.installSeam();
    this.spawn();
    this.sendTimer = setInterval(() => {
      if (!this.seam?.driving) this.sendState();
    }, SEND_MS);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.visibility);
    // Dev-console hook: window.__autopilot(true) hands the wheel to the follower.
    window.__autopilot = (enabled) => {
      this.autopilot = enabled;
    };
    this.animation = requestAnimationFrame(this.frame);
  }
  private resize = (): void => {
    const width = this.container.clientWidth,
      height = Math.max(1, this.container.clientHeight);
    this.bundle.camera.aspect = width / height;
    this.bundle.camera.updateProjectionMatrix();
    this.bundle.renderer.setSize(width, height);
  };
  private visibility = (): void => {
    if (!document.hidden) this.restartFrameClock();
  };
  /** Discard wall time that no longer belongs to the car being rendered. */
  private restartFrameClock(): void {
    this.previous = performance.now();
  }
  private spawn(): void {
    this.car.spawnAtSample(
      this.track.samples.length - 14,
      this.seam ? 0 : (Math.random() - 0.5) * 7,
    );
    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = this.car.heading;
    snapBehindCar(this.bundle.camera, this.car.x, this.car.z, this.car.heading);
    this.restartFrameClock();
  }
  private respawn(): void {
    this.net.send({ type: "respawn" });
    this.spawn();
    this.clock = null;
    this.hud.setCurrentLap(null);
    this.nextCheckpoint = 0;
    this.localLapStart = null;
    this.pacer?.onRespawn();
  }
  private dismissPacer(): void {
    this.pacer?.dispose();
    this.pacer = null;
    this.pacerTimes = [];
    this.localLapStart = null;
    this.nextCheckpoint = 0;
    this.hud.hidePacerChip();
  }
  receiveReplayFrames(frames: ReplayFrame[], variant?: Variant): void {
    if (!this.pacer) return;
    this.pacer.setFrames(frames, variant);
    this.pacerTimes = pacerCheckpointTimes(frames, this.track.checkpoints);
  }
  onMessage(message: ServerMessage): void {
    if (message.type === "snapshot") {
      this.remote.onSnapshot(message.players);
      this.hud.setStandings(message.players, this.myId);
      const me = message.players.find((p) => p.id === this.myId);
      if (me) {
        this.progress = me;
        this.hud.setMyProgress(me);
        this.clock =
          me.lapStartT === null
            ? null
            : {
                elapsed: message.t - me.lapStartT,
                received: performance.now(),
              };
      }
    } else if (message.type === "lap") {
      if (message.playerId === this.myId) {
        this.seam?.recordLapSubmission(message.laps);
        const suffix = message.isTrackRecord
          ? "  TRACK RECORD!"
          : message.isPersonalBest
            ? "  Personal best!"
            : "";
        this.hud.toast(
          `Lap ${message.laps} / ${formatMs(message.lapTimeMs)}${suffix}`,
          message.isTrackRecord,
        );
      } else if (message.isTrackRecord)
        this.hud.toast(`${message.name} set a track record: ${formatMs(message.lapTimeMs)}`, true);
    }
  }
  private sendState(): void {
    this.net.send({
      type: "state",
      x: this.car.x,
      y: 0,
      z: this.car.z,
      rot: this.car.heading,
      speed: this.car.speed,
    });
  }
  private checkCrossing(now: number): void {
    if (!this.pacer) return;
    const cp = this.track.checkpoints[this.nextCheckpoint];
    if (Math.hypot(this.car.x - cp.x, this.car.z - cp.z) > CHECKPOINT_RADIUS) return;
    const crossed = this.nextCheckpoint;
    this.nextCheckpoint = (crossed + 1) % this.track.checkpoints.length;
    if (crossed === 0) {
      this.localLapStart = now;
      this.pacer.restart(now);
      return;
    }
    if (this.localLapStart === null || !this.pacer.isPlaying()) return;
    const delta = pacerDelta(this.pacerTimes, crossed, now - this.localLapStart);
    if (delta !== null)
      this.hud.toast(`vs Pacer ${delta < 0 ? "−" : "+"}${Math.round(Math.abs(delta))}ms`);
  }
  private frame = (now: number): void => {
    if (this.disposed) return;
    const elapsed = Math.max(0, (now - this.previous) / 1000);
    this.previous = now;
    let dt = Math.min(elapsed, 0.05),
      input = IDLE;
    const injecting = Boolean(this.seam?.driving);
    // Remote cars move first so the local car collides with them where they are drawn.
    this.remote.update(dt);
    if (this.seam?.driving) {
      dt = this.seam.advance(elapsed, 3);
    } else {
      input = this.autopilot
        ? autopilotInput(this.car, this.track.samples, 12)
        : this.input.read(dt);
      this.car.advance(elapsed, input, this.remote.obstacles());
    }
    const pose = injecting ? this.car : this.car.getRenderPose();
    this.carMesh.position.set(pose.x, 0, pose.z);
    this.carMesh.rotation.y = pose.heading;
    animateCar(this.carMesh, pose.speed, input.steer, dt);
    this.checkCrossing(now);
    this.pacer?.update(now, dt);
    followCar(this.bundle.camera, pose.x, pose.z, pose.heading, dt);
    updateSun(this.bundle.sun, pose.x, pose.z);
    this.hud.setSpeed(this.car.speed);
    this.hud.setPosition(this.car.x, this.car.z);
    this.hud.setRemotePositions(this.remote.positions());
    this.hud.setOffTrack(!this.car.onTrack && Math.abs(this.car.speed) > 1);
    this.hud.setCheckpointMissed(
      Boolean(
        this.clock &&
        this.progress &&
        checkpointMissed(
          this.car.centerIndex,
          this.checkpoints[this.progress.nextCheckpoint],
          this.track.samples.length,
          8,
        ),
      ),
    );
    this.hud.setCurrentLap(
      this.clock ? this.clock.elapsed + performance.now() - this.clock.received : null,
    );
    // While the e2e seam replays inputs, skip the draw: under software WebGL a
    // frame costs 100ms+, and the seam's per-frame step cap (which keeps state
    // sends from bursting past the server's speed window) would turn that into a
    // lap several times slower than real time. Nothing asserts on pixels while
    // inputs are injected; rendering resumes once the recording is spent.
    if (!injecting) this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    this.animation = requestAnimationFrame(this.frame);
  };
  private installSeam(): void {
    if (!import.meta.env.VITE_E2E) return;
    this.seam = new E2eSeam(
      {
        step: (dt, input) => this.car.update(dt, input),
        localState: () => ({
          position: { x: this.car.x, z: this.car.z },
          heading: this.car.heading,
          speed: this.car.speed,
          checkpoint: this.progress?.nextCheckpoint ?? 0,
          lap: {
            laps: this.progress?.laps ?? 0,
            active: this.progress?.lapStartT != null,
            lastLapMs: this.progress?.lastLapMs ?? null,
            bestLapMs: this.progress?.bestLapMs ?? null,
          },
        }),
        remotePositions: () => this.remote.positions(),
        sendState: () => this.sendState(),
        playerVariants: () => ({
          [this.myId]: resolveVariant(this.myId, this.variant),
          ...this.remote.resolvedVariants(),
        }),
        pacerVariant: () => this.pacer?.resolvedVariant() ?? null,
        pacerState: () => this.pacer?.state() ?? null,
      },
      SEND_MS,
    );
    this.seam.install();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    clearInterval(this.sendTimer);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.visibility);
    this.input.detach();
    this.touch.dispose();
    this.remote.dispose();
    this.pacer?.dispose();
    this.seam?.dispose();
    this.hud.dispose();
    disposeCarMesh(this.carMesh);
    disposeWorld(this.bundle);
    this.container.remove();
    delete window.__autopilot;
  }
}
