import * as THREE from "three";
import {
  CHECKPOINT_PENALTY_MS,
  DEFAULT_DIFFICULTY,
  DEFAULT_TRACK_SLUG,
  gridSlot,
  MAX_SPEED_MS,
  medalTimes,
  pacerCheckpointTimes,
  reachedCheckpoint,
  resolveTrack,
  type Difficulty,
  type PlayerSnapshot,
  type RacePacer,
  type RaceState,
  type ReplayFrame,
  type ScenePreset,
  type ServerMessage,
  type Standing,
  type Track,
  type Variant,
} from "@racing/shared";
import type { Net } from "../net";
import type { ArmedPacer } from "../ui/lobby";
import { Hud } from "../ui/hud";
import { formatMs } from "../util";
import { animateCar, createCarMesh, disposeCarMesh, resolveVariant } from "./car";
import { Input, type CarInput } from "./input";
import { TouchControls, type SteeringMode } from "./touch";
import { CarPhysics } from "./physics";
import { RemotePlayers } from "./remote";
import { ServerClock } from "./server-clock";
import { PacerOverlay, pacerDelta } from "./pacer";
import { GridPacers } from "./grid-pacers";
import { ladderStep, standingOn, type Board, type Rival } from "./ladder";
import type { Pose } from "./pose-interpolation";
import {
  cycleTarget,
  driveMode,
  raceEvents,
  raceRole,
  racingIds,
  spectatorTarget,
  type DriveMode,
} from "./race";
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
import { E2eSeam } from "./e2e-seam";
import { autopilotInput } from "./harness";
import { Rumble } from "./gamepad";
import type { HeardCar, RaceSound, Sound } from "./sound";
import { impactLevel, roughness, type Listener } from "./sound-model";

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
  private readonly sendTimer: ReturnType<typeof setInterval>;
  private seam: E2eSeam | null = null;
  private readonly started: Promise<void>;
  private readonly resolution: AdaptiveResolution | null;
  private pacer: PacerOverlay | null = null;
  private sound: RaceSound | null;
  private readonly rumble = new Rumble();
  /** Where the camera hears from; refreshed every frame. */
  private readonly listener: Listener = { x: 0, z: 0, forwardX: 0, forwardZ: 1 };
  private readonly view = new THREE.Vector3();
  private readonly unsubscribeSound: () => void;
  private pacerTimes: (number | null)[] = [];
  private readonly gridPacers: GridPacers;
  /** The Room's race, as the server last published it; null while free driving. */
  private race: RaceState | null = null;
  /** As of the last frame, or the last race update. */
  private mode: DriveMode = "drive";
  /** GO time of the race this car was last put on the grid for. */
  private gridFor: number | null = null;
  /** The car a Spectator chose to watch; unset follows whoever leads. */
  private following: string | null = null;
  private readonly board: Board;
  private standings: readonly Standing[] = [];
  private nextCheckpoint = 0;
  private localLapStart: number | null = null;
  private progress: PlayerSnapshot | null = null;
  private readonly serverClock = new ServerClock();
  /** Server time the lap in progress started; null before the line is crossed. */
  private lapStartT: number | null = null;
  /** Checkpoint Penalties the lap in progress has collected, per the server. */
  private lapPenaltyMs = 0;
  private missedCheckpoints = 0;
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
    scene: ScenePreset = "sunset",
    private readonly audio: Sound | null = null,
  ) {
    this.track = resolveTrack(trackSlug);
    this.board = { track: this.track.id, difficulty };
    this.car = new CarPhysics(difficulty, this.track.samples);
    this.container.className = "race-viewport";
    parent.append(this.container);
    this.bundle = createScene(this.container, this.track.samples, scene);
    buildTrack(this.bundle.scene, this.track);
    this.remote = new RemotePlayers(this.bundle.scene, myId, MAX_SPEED_MS[difficulty]);
    this.gridPacers = new GridPacers(this.bundle.scene);
    this.carMesh = createCarMesh(myId, undefined, variant);
    this.bundle.scene.add(this.carMesh);
    const settings = audio?.settings;
    const toggleMute = settings && (() => settings.toggleMuted());
    this.hud = new Hud(
      parent,
      roomName,
      onLeave,
      this.track.checkpoints.length,
      () => this.requestRespawn(),
      this.track,
      {
        start: (format) => this.net.send({ type: "startRace", format }),
        cycle: (step) => this.cycle(step),
      },
      toggleMute,
    );
    this.unsubscribeSound = settings
      ? settings.subscribe(() => this.hud.setMuted(settings.muted))
      : () => undefined;
    if (settings) this.hud.setMuted(settings.muted);
    this.touch = new TouchControls(parent, steering);
    this.input = new Input(this.touch);
    this.input.onRespawn = () => this.requestRespawn();
    this.input.onCycle = (step) => this.cycle(step);
    this.input.onRaceRival = () => this.hud.acceptRivalPrompt();
    this.input.onToggleMute = toggleMute ?? null;
    this.input.attach();
    if (armedPacer) {
      this.pacer = new PacerOverlay(this.bundle.scene, armedPacer.name);
      this.hud.showPacerChip(() => this.dismissPacer(), armedPacer.name);
    }
    this.installSeam();
    this.spawn();
    this.sendTimer = setInterval(() => {
      // A Spectator has no car, and the e2e seam sends its own states while it drives.
      if (this.mode === "spectate" || (this.mode === "drive" && this.seam?.driving)) return;
      this.sendState();
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
    // Last, so a race view that failed to start leaves no voices playing.
    this.sound = audio?.race(this.car.topSpeed) ?? null;
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
        updateSun(this.bundle, this.car.x, this.car.z);
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
  private spawn(spot: { sample: number; offset: number } | null = null): void {
    this.car.spawnAtSample(
      spot?.sample ?? this.track.samples.length - 14,
      spot?.offset ?? (this.seam ? 0 : (Math.random() - 0.5) * 7),
    );
    this.carMesh.position.set(this.car.x, 0, this.car.z);
    this.carMesh.rotation.y = this.car.heading;
    snapBehindCar(this.bundle.camera, this.car.x, this.car.z, this.car.heading);
    this.restartFrameClock();
  }
  /** The driver's Respawn: not while the car waits on the grid for GO, nor for a Spectator. */
  private requestRespawn(): void {
    if (this.mode === "drive") this.respawn();
  }
  private respawn(): void {
    this.net.send({ type: "respawn" });
    this.resetCar();
  }
  /** Back to the spawn, or to the car's own grid slot while it races, abandoning the lap in progress. */
  private resetCar(): void {
    const slot = this.race?.entrants.find((e) => e.id === this.myId && e.status === "racing")?.slot;
    this.spawn(slot === undefined ? null : gridSlot(this.track, slot));
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
  /** Seat a race's grid Pacers, linked now rather than when they appear at GO. */
  private seatGridPacers(pacers: RacePacer[]): void {
    // Like a rebuilt armed Pacer, they wait for the precompile; the race has not started yet.
    void this.started.then(() => {
      if (this.disposed) return;
      for (const model of this.gridPacers.set(pacers))
        this.bundle.renderer.compile(model, this.bundle.camera, this.bundle.scene);
    });
  }
  private setRace(race: RaceState | null): void {
    for (const event of raceEvents(this.race, race, this.myId)) this.hud.toast(event);
    const previous = this.race;
    this.race = race;
    this.updateMode(performance.now());
    this.remote.setRacing(racingIds(race));
    this.hud.setRace(race, this.myId);
    if (!race) {
      this.gridPacers.clear();
      this.following = null;
      // The Room is back to free driving: every car starts again from the spawn.
      if (previous) this.respawn();
      return;
    }
    // The armed Pacer sits races out.
    if (!previous) this.pacer?.onRespawn();
    const onGrid = race.phase === "countdown" && raceRole(race, this.myId) === "racing";
    if (onGrid && this.gridFor !== race.goT) {
      // The server has already reset this car's lap, so this is no Respawn of the driver's.
      this.gridFor = race.goT;
      this.resetCar();
    }
  }
  /** Re-judge what the local car does at `localNow`; returns the server time that was judged at. */
  private updateMode(localNow: number): number {
    const serverNow = this.serverClock.now(localNow);
    this.mode = driveMode(this.race, this.myId, serverNow);
    return serverNow;
  }
  private cycle(step: 1 | -1): void {
    if (this.mode === "spectate") this.following = cycleTarget(this.race, this.following, step);
  }
  /** The car a Spectator watches, named in the banner, and its pose if it is drawn. */
  private watch(): Pose | null {
    const target = spectatorTarget(this.race, this.following);
    // A chosen car that stopped racing hands the camera back to whoever leads.
    if (target?.id !== this.following) this.following = null;
    this.hud.setSpectating(target?.name ?? null);
    return target && (this.remote.pose(target.id) ?? this.gridPacers.pose(target.id));
  }
  /** Swap the Pacer for a Rival in place; like any Pacer it starts at the next start-line crossing. */
  private raceRival({ name }: Rival): void {
    this.dismissPacer();
    this.hud.hideRivalPrompt();
    this.pacer = new PacerOverlay(this.bundle.scene, name);
    this.hud.showPacerChip(() => this.dismissPacer(), name);
    this.net.send({ type: "getReplay", name, ...this.board });
  }
  /**
   * The driver's Standings feed the HUD's Medal chip. Those answering one of the
   * driver's laps may also award a better Medal and climb the Rival ladder; the
   * baseline, or a reply to the Lobby's request, only refreshes the chip.
   */
  setStandings(standings: readonly Standing[], afterLap = false): void {
    const before = this.standings;
    this.standings = standings;
    this.hud.setMedal(
      medalTimes(this.board.track, this.board.difficulty),
      standingOn(standings, this.board)?.bestMs ?? null,
    );
    if (!afterLap) return;
    const { award, rival } = ladderStep(
      before,
      standings,
      this.board,
      this.pacer?.driverName ?? null,
    );
    if (award) this.hud.awardMedal(award.medal, award.lapMs, award.unlocked);
    if (rival?.kind === "offer") {
      const offered = rival.rival;
      this.hud.showRivalPrompt(offered.name, offered.timeMs, () => this.raceRival(offered));
    } else if (rival?.kind === "beaten") {
      const { next } = rival;
      if (next) this.raceRival(next);
      this.hud.toast(
        next
          ? `Rival beaten! Next up: ${next.name} ${formatMs(next.timeMs)}`
          : "Rival beaten! Top of the ladder — no faster replay on this board",
        true,
      );
    }
  }
  receiveReplayFrames(frames: ReplayFrame[], variant?: Variant, name?: string): void {
    // A recorded Variant rebuilds the Pacer, disposing materials the precompile may
    // still be waiting on, so the frames wait for it; the race has not started yet.
    void this.started.then(() => {
      // A human Replay asked for before the Rival ladder swapped its Pacer is stale.
      if (!this.pacer || this.disposed || (name !== undefined && name !== this.pacer.driverName))
        return;
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
        this.lapPenaltyMs = me.lapPenaltyMs ?? 0;
        const missed = me.missedCheckpoints ?? 0;
        if (missed > this.missedCheckpoints)
          this.hud.flashCheckpointPenalty(
            (missed - this.missedCheckpoints) * CHECKPOINT_PENALTY_MS,
          );
        this.missedCheckpoints = missed;
      }
    } else if (message.type === "lap") {
      if (message.playerId === this.myId) {
        this.seam?.recordLapSubmission(message.laps);
        const suffix = message.isTrackRecord
          ? "  TRACK RECORD!"
          : message.isPersonalBest
            ? "  Personal best!"
            : "";
        const penalty = message.penaltyMs ? ` (+${message.penaltyMs / 1000}s)` : "";
        this.hud.toast(
          `Lap ${message.laps} / ${formatMs(message.lapTimeMs)}${penalty}${suffix}`,
          message.isTrackRecord,
        );
      } else if (message.isTrackRecord)
        this.hud.toast(`${message.name} set a track record: ${formatMs(message.lapTimeMs)}`, true);
    } else if (message.type === "racePacers") this.seatGridPacers(message.pacers);
    else if (message.type === "race") this.setRace(message.race);
  }
  private sendState(): void {
    this.net.send({
      type: "state",
      x: this.car.x,
      y: 0,
      z: this.car.z,
      rot: this.car.heading,
      speed: this.car.speed,
      t: this.stateTime,
    });
  }
  private checkCrossing(now: number): void {
    if (!this.pacer) return;
    const crossed = reachedCheckpoint(
      this.track.checkpoints,
      this.nextCheckpoint,
      this.car.x,
      this.car.z,
    );
    if (crossed === null) return;
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
    const serverNow = this.updateMode(now);
    const spectating = this.mode === "spectate";
    // Injected inputs wait for GO, and for the end of a race their driver spectates.
    const seam = this.mode === "drive" && this.seam?.driving ? this.seam : null;
    const injecting = seam !== null;
    // Remote cars move first so the local car collides with them where they are drawn.
    this.remote.update(dt, serverNow);
    if (seam) {
      // The seam sends mid-advance; its steps all belong to this frame.
      this.stateTime = now;
      dt = seam.advance(elapsed, 3);
    } else if (this.mode === "drive") {
      input = this.autopilot
        ? autopilotInput(this.car, this.track.samples, 12)
        : this.input.read(dt);
      this.car.advance(elapsed, input, this.remote.obstacles());
      this.stateTime = now - this.car.backlog * 1000;
    } else {
      // Held on the grid, where its states still show it, or put away while spectating.
      this.stateTime = now;
    }
    const pose = injecting ? this.car : this.car.getRenderPose();
    this.carMesh.visible = !spectating;
    this.carMesh.position.set(pose.x, 0, pose.z);
    this.carMesh.rotation.y = pose.heading;
    animateCar(this.carMesh, pose.speed, input.steer, dt);
    if (this.race) this.gridPacers.update(this.race, serverNow, dt);
    else {
      this.checkCrossing(now);
      this.pacer?.update(now, dt);
    }
    const view = spectating ? this.watch() : pose;
    if (!spectating) this.hud.setSpectating(null);
    if (view) {
      followCar(this.bundle.camera, view.x, view.z, view.heading, dt);
      updateSun(this.bundle, view.x, view.z);
    }
    const remotes = this.remote.positions();
    const gridPacers = this.gridPacers.positions();
    this.feedback(now, dt, input, spectating, remotes, gridPacers);
    this.touch.setHidden(spectating);
    this.hud.setRespawnEnabled(this.mode === "drive");
    this.hud.setRaceClock(serverNow);
    this.hud.setSpeed(spectating ? (view?.speed ?? 0) : this.car.speed);
    this.hud.setPosition(this.car.x, this.car.z);
    this.hud.setDriverShown(!spectating);
    this.hud.setRemotePositions(remotes, gridPacers);
    this.hud.setOffTrack(!spectating && !this.car.onTrack && Math.abs(this.car.speed) > 1);
    this.hud.setCurrentLap(
      spectating || this.lapStartT === null
        ? null
        : Math.max(serverNow - this.lapStartT, 0) + this.lapPenaltyMs,
    );
    // While the e2e seam replays inputs, skip the draw: under software WebGL a
    // frame costs 100ms+, and the seam's per-frame step cap (which keeps state
    // sends from bursting past the server's speed window) would turn that into a
    // lap several times slower than real time. Nothing asserts on pixels while
    // inputs are injected; rendering resumes once the recording is spent.
    if (!injecting) this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    this.animation = requestAnimationFrame(this.frame);
  };
  /**
   * What the driver hears and, on a gamepad, feels this frame. A Spectator's car is put
   * away, so it neither sounds nor rumbles; the cars they watch still do.
   */
  private feedback(
    now: number,
    dt: number,
    input: CarInput,
    spectating: boolean,
    remotes: HeardCar[],
    gridPacers: HeardCar[],
  ): void {
    const impact = this.car.takeImpact();
    const hit = spectating ? 0 : impactLevel(impact);
    this.rumble.impact(hit, now);
    this.rumble.surface(spectating ? 0 : roughness(this.car.speed, this.car.onTrack), now);
    if (!this.sound) return;
    const { camera } = this.bundle;
    camera.getWorldDirection(this.view);
    const flat = Math.hypot(this.view.x, this.view.z) || 1;
    this.listener.x = camera.position.x;
    this.listener.z = camera.position.z;
    this.listener.forwardX = this.view.x / flat;
    this.listener.forwardZ = this.view.z / flat;
    // The armed Pacer is put away during a race, when the grid's Pacers drive instead.
    const pacer = this.pacer?.pose;
    const cars: HeardCar[] = [...remotes, ...gridPacers.map((car) => ({ ...car, pacer: true }))];
    if (pacer) cars.push({ id: "pacer", x: pacer.x, z: pacer.z, speed: pacer.speed, pacer: true });
    try {
      const driver = spectating
        ? null
        : {
            speed: this.car.speed,
            throttle: input.throttle,
            steer: input.steer,
            onTrack: this.car.onTrack,
            hit,
          };
      this.sound.update(dt, driver, this.listener, cars);
    } catch (error) {
      // The browser's audio API throws where the frame loop must not: lose the sound, not the race.
      console.warn("Race sound stopped", error);
      this.sound.dispose();
      this.sound = null;
    }
  }
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
        playerVariants: () => ({
          [this.myId]: resolveVariant(this.myId, this.variant),
          ...this.remote.resolvedVariants(),
        }),
        pacerVariant: () => this.pacer?.resolvedVariant() ?? null,
        pacerState: () => this.pacer?.state() ?? null,
        soundState: () => {
          const output = this.audio?.state();
          return output && this.sound ? { ...output, engines: this.sound.engines } : null;
        },
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
    this.sound?.dispose();
    this.unsubscribeSound();
    this.remote.dispose();
    this.pacer?.dispose();
    this.gridPacers.clear();
    this.seam?.dispose();
    this.hud.dispose();
    disposeCarMesh(this.carMesh);
    disposeWorld(this.bundle);
    this.container.remove();
    delete window.__autopilot;
  }
}
