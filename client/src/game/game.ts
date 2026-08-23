import * as THREE from "three";
import {
  CHECKPOINT_RADIUS,
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  nearestCenterline,
  resolveTrack,
  TRACK_DIVISIONS,
  type Difficulty,
  type PlayerSnapshot,
  type ReplayFrame,
  type ServerMessage,
  type Track,
} from "@racing/shared";
import { checkpointMissed } from "./checkpoint-miss";
import type { Net } from "../net";
import type { ArmedPacer } from "../ui/lobby";
import { Hud } from "../ui/hud";
import { formatMs } from "../util";
import { animateCar, createCarMesh, resolveVariant } from "./car";
import { Input, type CarInput } from "./input";
import { TouchControls } from "./touch";
import { CarPhysics } from "./physics";
import { RemotePlayers } from "./remote";
import { PacerOverlay, pacerCheckpointTimes, pacerDelta } from "./pacer";
import { createScene, disposeRenderer, updateSun, followCar, snapBehindCar, type SceneBundle } from "./scene";
import { buildTrack } from "./trackMesh";
import { E2eSeam, E2E_DT } from "./e2e-seam";

const SEND_INTERVAL_MS = 50;
/**
 * Upper bound (s) on the frame delta handed to the visual smoothing systems
 * (camera follow, wheel-spin animation, remote interpolation, input ramp). The
 * physics no longer uses this clamp — advance() gets the raw elapsed time and
 * caps catch-up internally (see MAX_ACCUMULATED_TIME) — but the cosmetic lerps
 * still want a bounded step so a stall can't make them jump.
 */
const MAX_VISUAL_DT = 0.05;
/** Spawn just before the start/finish line so crossing it starts the lap timer. */
const SPAWN_SAMPLE = TRACK_DIVISIONS - 14;
/** Tolerance in samples before declaring a checkpoint missed (~1.5× CHECKPOINT_RADIUS). */
const CP_MISS_MARGIN_SAMPLES = 8;
const IDLE_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0 };

export class Game {
  private bundle: SceneBundle;
  private hud: Hud;
  private input: Input;
  private touch: TouchControls;
  private car: CarPhysics;
  private carMesh: THREE.Group;
  private remote: RemotePlayers;
  private pacer: PacerOverlay | null = null;
  private sendTimer: ReturnType<typeof setInterval>;
  private running = true;
  private lastFrame = performance.now();
  private container: HTMLElement;
  private track: Track;

  // Current-lap clock derived from server snapshots (no clock sync needed).
  private curLapBaseMs: number | null = null;
  private curLapReceivedAt = 0;

  private lastMe: PlayerSnapshot | null = null;
  // Local lap clock anchored to the client-detected start-line crossing. Drives
  // the Pacer restart and delta toast only (PRD #27: immediate visual response);
  // the HUD lap clock stays server-derived via curLapBaseMs.
  private localLapStartMs: number | null = null;
  // Next checkpoint the local crossing detector expects (mirrors the server's
  // in-order timing rules; see updateLocalCrossings).
  private localNextCheckpoint = 0;
  // Pacer's pre-computed checkpoint-crossing times (ms, lap-relative).
  private pacerCrossingTimes: (number | null)[] = [];
  /** Sample index of each checkpoint, pre-computed for checkpointMissed. */
  private checkpointSampleIndices: number[];

  private autopilot = false;
  private seam: E2eSeam | null = null;
  /** Simulated ms accrued toward the next state send while the seam drives. */
  private seamSendAccumMs = 0;
  /** Real seconds accrued toward the seam's next fixed-step advance. */
  private seamStepAccumS = 0;

  private onResize = () => {
    const { camera, renderer } = this.bundle;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  // requestAnimationFrame is paused while the tab is backgrounded, so the first
  // frame after the tab is revealed would otherwise carry a wall-clock delta of
  // however long the tab slept (minutes). advance()'s backlog cap already bounds
  // the physics damage, but resetting lastFrame here keeps that first delta near
  // zero so neither physics nor the visual lerps see a spurious huge step.
  private onVisibility = () => {
    if (!document.hidden) this.lastFrame = performance.now();
  };

  constructor(
    parent: HTMLElement,
    private net: Net,
    private myId: string,
    roomName: string,
    onLeave: () => void,
    difficulty: Difficulty = DEFAULT_DIFFICULTY,
    trackSlug: string = DEFAULT_TRACK_SLUG,
    armedPacer?: ArmedPacer | null
  ) {
    this.track = resolveTrack(trackSlug);
    this.checkpointSampleIndices = this.track.checkpoints.map(
      (cp) => nearestCenterline(cp.x, cp.z, this.track.samples).index
    );
    this.car = new CarPhysics(difficulty, this.track.samples);
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;inset:0;";
    parent.appendChild(this.container);

    this.bundle = createScene(this.container, this.track.samples);
    buildTrack(this.bundle.scene, this.track.samples);

    this.remote = new RemotePlayers(this.bundle.scene, myId);
    this.installE2eSeam();
    this.car.spawnAtSample(SPAWN_SAMPLE, this.spawnOffset());
    this.carMesh = createCarMesh(myId);
    this.bundle.scene.add(this.carMesh);
    if (armedPacer) this.pacer = new PacerOverlay(this.bundle.scene);
    this.hud = new Hud(parent, roomName, onLeave, this.track.checkpoints.length);
    if (this.pacer) {
      this.hud.showPacerChip(() => this.dismissPacer(), armedPacer?.name ?? "");
    }
    this.touch = new TouchControls(parent);
    this.input = new Input(this.touch);
    this.input.onRespawn = () => this.respawn();
    this.input.attach();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.snapCameraBehindCar();

    this.sendTimer = setInterval(() => {
      // While the seam drives, physics advances per rendered frame rather than in
      // real time, so frame() paces sends off simulated time instead (issue: fast
      // renderers outran this timer and the server missed checkpoints).
      if (this.seam?.driving) return;
      this.sendState();
    }, SEND_INTERVAL_MS);

    // Debug/testing hook: drives the car around the track automatically.
    (window as unknown as Record<string, unknown>).__autopilot = (on: boolean) => {
      this.autopilot = on;
    };

    requestAnimationFrame(this.frame);
  }

  private installE2eSeam(): void {
    if (!import.meta.env.VITE_E2E) return;

    this.seam = new E2eSeam({
      step: (dt, input) => this.car.update(dt, input),
      localState: () => ({
        position: { x: this.car.x, z: this.car.z },
        rotation: this.car.heading,
        velocity: this.car.speed,
        checkpoint: this.lastMe?.nextCheckpoint ?? 0,
        lap: {
          laps: this.lastMe?.laps ?? 0,
          active: this.lastMe?.lapStartT !== null && this.lastMe?.lapStartT !== undefined,
          lastLapMs: this.lastMe?.lastLapMs ?? null,
          bestLapMs: this.lastMe?.bestLapMs ?? null,
        },
      }),
      remotePlayerIds: () => this.remote.playerIds(),
      // The local mesh is built without an explicit Variant (the local picker
      // lands with the Garage, #125), so its resolved Variant is the hash fallback.
      playerVariants: () => ({
        [this.myId]: resolveVariant(this.myId),
        ...this.remote.resolvedVariants(),
      }),
    });
    this.seam.install();
  }

  private spawnOffset(): number {
    return this.seam ? 0 : (Math.random() - 0.5) * 7;
  }

  receiveReplayFrames(frames: ReplayFrame[]): void {
    if (!this.pacer) return;
    this.pacer.setFrames(frames);
    this.pacerCrossingTimes = pacerCheckpointTimes(frames, this.track.checkpoints);
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
    this.lastMe = me;
    this.hud.setMyProgress(me);
    this.curLapBaseMs = me.lapStartT === null ? null : serverT - me.lapStartT;
    this.curLapReceivedAt = performance.now();
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

  /**
   * Client-detected checkpoint crossings: entering CHECKPOINT_RADIUS of the next
   * expected checkpoint, in lap order (mirrors the server's timing rules and
   * CheckpointTracker in harness.ts). Anchors the Pacer restart and delta toast
   * to the local crossing for immediate response (PRD #27); the server stays
   * authoritative for lap timing and the HUD clock.
   */
  private updateLocalCrossings(nowMs: number): void {
    if (!this.pacer) return;
    const cp = this.track.checkpoints[this.localNextCheckpoint];
    const dx = this.car.x - cp.x;
    const dz = this.car.z - cp.z;
    if (dx * dx + dz * dz > CHECKPOINT_RADIUS * CHECKPOINT_RADIUS) return;

    const crossed = this.localNextCheckpoint;
    this.localNextCheckpoint = (crossed + 1) % this.track.checkpoints.length;

    if (crossed === 0) {
      // Start line: begin a fresh local lap and race the recording from frame zero.
      this.localLapStartMs = nowMs;
      this.pacer.restart(nowMs);
      return;
    }
    // Delta toast at intermediate checkpoints (no delta at CP0 — it is the lap
    // boundary, where the driver already gets the lap-time toast). Suppressed
    // when the Pacer isn't playing (e.g. replay frames arrived after this lap's
    // start-line crossing), since there's no visible Pacer to compare against.
    if (this.localLapStartMs !== null && this.pacer.isPlaying()) {
      const delta = pacerDelta(this.pacerCrossingTimes, crossed, nowMs - this.localLapStartMs);
      if (delta !== null) {
        const abs = Math.round(Math.abs(delta));
        this.hud.toast(delta < 0 ? `vs Pacer −${abs}ms` : `vs Pacer +${abs}ms`);
      }
    }
  }

  private onLap(msg: Extract<ServerMessage, { type: "lap" }>): void {
    if (msg.playerId === this.myId) {
      this.seam?.recordLapSubmission(msg.lapTimeMs, msg.laps);
      let suffix = "";
      if (msg.isTrackRecord) {
        suffix = "  TRACK RECORD!";
      } else if (msg.isPersonalBest) {
        suffix = "  Personal best!";
      }
      this.hud.toast(`Lap ${msg.laps} — ${formatMs(msg.lapTimeMs)}${suffix}`, msg.isTrackRecord);
    } else if (msg.isTrackRecord) {
      this.hud.toast(`${msg.name} set a track record: ${formatMs(msg.lapTimeMs)}`, true);
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    // Real wall-clock elapsed drives physics so the client's simulated distance
    // stays aligned with the server's Date.now()-based lap clock across frame
    // stalls (issue #39); advance() caps its own catch-up. A clamped copy drives
    // the visual smoothing systems, which want a bounded step.
    const elapsed = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // Not const: under the e2e seam the fixed-step count replaces the visual dt.
    let dt = Math.min(elapsed, MAX_VISUAL_DT);

    let input: CarInput;
    if (this.seam?.driving) {
      // The seam advances physics itself in fixed E2E_DT steps; the visual
      // systems below get the simulated time those steps covered.
      // Spend real elapsed time as the step budget so the seam never simulates
      // faster than the server's wall clock (which would make every lap implausible).
      this.seamStepAccumS += elapsed;
      const budget = Math.floor(this.seamStepAccumS / E2E_DT);
      const steps = this.seam.stepFrame(budget);
      this.seamStepAccumS -= steps * E2E_DT;
      dt = steps * E2E_DT;
      input = IDLE_INPUT;
      // Keep the server's sample spacing tied to simulated time, so checkpoint
      // proximity checks see the same density regardless of how fast we render.
      this.seamSendAccumMs += dt * 1000;
      while (this.seamSendAccumMs >= SEND_INTERVAL_MS) {
        this.seamSendAccumMs -= SEND_INTERVAL_MS;
        this.sendState();
      }
    } else {
      input = this.autopilot ? this.autopilotInput() : this.input.read(dt);
      this.car.advance(elapsed, input);
    }

    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = this.car.heading;
    animateCar(this.carMesh, this.car.speed, input.steer, dt);

    this.remote.update(dt);
    this.updateLocalCrossings(now);
    this.pacer?.update(now, dt);
    this.updateCamera(dt);
    updateSun(this.bundle.sun, this.car.x, this.car.z);

    this.hud.setSpeed(this.car.speed);
    this.hud.setOffTrack(!this.car.onTrack && Math.abs(this.car.speed) > 1);

    const me = this.lastMe;
    this.hud.setCheckpointMissed(
      this.curLapBaseMs !== null &&
        me !== null &&
        checkpointMissed(
          this.car.centerIndex,
          this.checkpointSampleIndices[me.nextCheckpoint],
          this.track.samples.length,
          CP_MISS_MARGIN_SAMPLES
        )
    );

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
    this.car.spawnAtSample(SPAWN_SAMPLE, this.spawnOffset());
    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = this.car.heading;
    this.snapCameraBehindCar();
    this.curLapBaseMs = null;
    this.hud.setCurrentLap(null);
    // Reset the local detector to the start line so the Pacer stays hidden
    // until the next client-detected crossing.
    this.localLapStartMs = null;
    this.localNextCheckpoint = 0;
    this.pacer?.onRespawn();
  }

  private dismissPacer(): void {
    this.pacer?.dispose();
    this.pacer = null;
    this.pacerCrossingTimes = [];
    // Reset the local crossing detector too, so no stale state survives if a
    // re-arm path is ever added.
    this.localLapStartMs = null;
    this.localNextCheckpoint = 0;
    this.hud.hidePacerChip();
  }

  private autopilotInput(): CarInput {
    const samples = this.track.samples;
    const n = samples.length;
    const target = samples[(this.car.centerIndex + 12) % n];
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
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.remote.dispose();
    this.pacer?.dispose();
    this.hud.dispose();
    this.seam?.dispose();
    disposeRenderer(this.bundle.renderer);
    this.container.remove();
    delete (window as unknown as Record<string, unknown>).__autopilot;
  }
}
