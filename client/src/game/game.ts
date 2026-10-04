import * as THREE from "three";
import {
  CHECKPOINT_RADIUS,
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  MAX_SPEED_MS,
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
import type { DirectLinks } from "../direct-links";
import type { ArmedPacer } from "../ui/lobby";
import { Hud } from "../ui/hud";
import { formatMs } from "../util";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import { Input, type CarInput } from "./input";
import { TouchControls, type SteeringMode } from "./touch";
import { CarPhysics } from "./physics";
import { RemotePlayers } from "./remote";
import { ServerClock } from "./server-clock";
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
import { AdaptiveResolution, CHEAP_RENDER, downgradeQuality, renderQuality } from "./quality";
import { checkpointMissed } from "./checkpoint-miss";
import { E2eSeam } from "./e2e-seam";
import { autopilotInput } from "./harness";

const SEND_MS = 50;
/** Start anyway if the driver never reports the shaders ready, e.g. after a context loss. */
const PRECOMPILE_LIMIT_MS = 5000;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0 };

declare global {
  interface Window {
    __autopilot?: (enabled: boolean) => void;
  }
}

/** A hidden remote car with a name tag, whose materials the first opponent will need. */
function compileTemplate(variant?: Variant): THREE.Group | null {
  try {
    const template = createCarMesh("compile", "compile", variant);
    template.visible = false;
    return template;
  } catch (error) {
    // The first opponent's shaders then link when it arrives.
    console.warn("Remote car shaders could not precompile", error);
    return null;
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
  private readonly started: Promise<void>;
  private readonly resolution: AdaptiveResolution | null;
  private pacer: PacerOverlay | null = null;
  private pacerTimes: (number | null)[] = [];
  private nextCheckpoint = 0;
  private localLapStart: number | null = null;
  private progress: PlayerSnapshot | null = null;
  private readonly serverClock = new ServerClock();
  /** Server time the lap in progress started; null before the line is crossed. */
  private lapStartT: number | null = null;
  private previous = performance.now();
  /**
   * When the car's physical state was current, on the local clock. Sent with
   * it, so other clients space its poses by when they happened, not by when
   * the send timer or the network delivered them.
   */
  private stateTime = this.previous;
  private animation = 0;
  private disposed = false;
  private autopilot = false;
  /** Poses sent so far and respawns so far, stamped on every pose (see PoseStamp). */
  private poseSeq = 0;
  private epoch = 0;
  private readonly stopDirectPoses: (() => void) | null;

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
    steering?: SteeringMode,
    private readonly links: DirectLinks | null = null,
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
    this.remote = new RemotePlayers(this.bundle.scene, myId, MAX_SPEED_MS[difficulty]);
    this.stopDirectPoses = links?.onPose((id, pose) => this.remote.onDirectPose(id, pose)) ?? null;
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
    this.touch = new TouchControls(parent, steering);
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
    // Software WebGL under e2e is always slow, and its tier is already the cheapest.
    this.resolution = CHEAP_RENDER
      ? null
      : new AdaptiveResolution(this.bundle.renderer.getPixelRatio(), renderQuality().minPixelRatio);
    this.started = this.start();
  }
  /**
   * Link every shader, and draw once, before the first frame instead of stalling
   * the first frames of the race. The scene already holds the (hidden) Pacer; the
   * remote-car template covers the first opponent's materials and name tag, and
   * the draw links the shadow pass's depth shaders, which compiling skips.
   */
  private async start(): Promise<void> {
    const { renderer, scene, camera } = this.bundle;
    const template = compileTemplate(this.variant);
    if (template) scene.add(template);
    try {
      renderer.compile(scene, camera);
      // Without parallel compilation the draw below links them just as synchronously.
      if (renderer.extensions.has("KHR_parallel_shader_compile")) await this.shadersLinked();
      if (!this.disposed) {
        updateSun(this.bundle.sun, this.car.x, this.car.z);
        renderer.render(scene, camera);
      }
    } catch (error) {
      console.warn("Shaders could not precompile", error);
    }
    // Removed but not disposed: disposing would release the programs it just linked.
    if (template) scene.remove(template);
    if (this.disposed) return;
    this.restartFrameClock();
    this.animation = requestAnimationFrame(this.frame);
  }
  /**
   * Poll the driver's parallel link, not compileAsync(), whose poller outlives a race
   * left early and then reads the disposed renderer.
   */
  private async shadersLinked(): Promise<void> {
    // three types info.programs without the readiness check its programs carry.
    const programs = (this.bundle.renderer.info.programs ?? []) as unknown as {
      isReady(): boolean;
    }[];
    const deadline = performance.now() + PRECOMPILE_LIMIT_MS;
    while (!this.disposed && performance.now() < deadline) {
      if (programs.every((program) => program.isReady())) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
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
    this.stateTime = this.previous;
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
    this.epoch++;
    this.spawn();
    this.lapStartT = null;
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
    // A recorded Variant rebuilds the Pacer, disposing materials the precompile may
    // still be waiting on, so the frames wait for it; the race has not started yet.
    void this.started.then(() => {
      if (!this.pacer || this.disposed) return;
      this.pacer.setFrames(frames, variant);
      this.pacerTimes = pacerCheckpointTimes(frames, this.track.checkpoints);
      // Link a rebuilt Pacer now, not when it first appears mid-lap.
      this.bundle.renderer.compile(this.pacer.model, this.bundle.camera, this.bundle.scene);
    });
  }
  onMessage(message: ServerMessage): void {
    if (message.type === "snapshot") {
      this.serverClock.observe(message.t, performance.now());
      this.remote.onSnapshot(message.players, message.t);
      this.hud.setStandings(message.players, this.myId);
      const me = message.players.find((p) => p.id === this.myId);
      if (me) {
        this.progress = me;
        this.hud.setMyProgress(me);
        this.lapStartT = me.lapStartT;
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
  /**
   * Report the car's pose to the server, which times laps from it, and to every
   * Direct Link, both stamped with when it was current (`stateTime`).
   */
  private sendState(): void {
    const stamp = { seq: ++this.poseSeq, epoch: this.epoch };
    const { x, z, heading: rot, speed } = this.car;
    const t = this.stateTime;
    this.net.send({ type: "state", x, y: 0, z, rot, speed, t, stamp });
    this.links?.broadcast({ stamp, t, x, z, rot, speed });
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
    this.adaptResolution(now);
    const elapsed = Math.max(0, (now - this.previous) / 1000);
    this.previous = now;
    let dt = Math.min(elapsed, 0.05),
      input = IDLE;
    const injecting = Boolean(this.seam?.driving);
    const serverNow = this.serverClock.now(now);
    // Remote cars move first so the local car collides with them where they are drawn.
    this.remote.update(dt, serverNow);
    if (this.seam?.driving) {
      // The seam sends mid-advance; its steps all belong to this frame.
      this.stateTime = now;
      dt = this.seam.advance(elapsed, 3);
    } else {
      input = this.autopilot
        ? autopilotInput(this.car, this.track.samples, 12)
        : this.input.read(dt);
      this.car.advance(elapsed, input, this.remote.obstacles());
      this.stateTime = now - this.car.backlog * 1000;
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
        this.lapStartT !== null &&
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
      this.lapStartT === null ? null : Math.max(serverNow - this.lapStartT, 0),
    );
    // While the e2e seam replays inputs, skip the draw: under software WebGL a
    // frame costs 100ms+, and the seam's per-frame step cap (which keeps state
    // sends from bursting past the server's speed window) would turn that into a
    // lap several times slower than real time. Nothing asserts on pixels while
    // inputs are injected; rendering resumes once the recording is spent.
    if (!injecting) this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    this.animation = requestAnimationFrame(this.frame);
  };
  private adaptResolution(now: number): void {
    const step = this.resolution?.frame(now) ?? null;
    if (step === "downgrade") downgradeQuality();
    else if (step !== null) this.bundle.renderer.setPixelRatio(step);
  }
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
        linkStates: () => this.links?.states() ?? {},
        poseSources: () => this.remote.sources(),
        directPoses: () => this.remote.directPoses(),
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
    this.stopDirectPoses?.();
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
