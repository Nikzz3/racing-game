import {
  CHECKPOINT_RADIUS,
  JEV_DECISION_INTERVAL_MS,
  JEV_DIFFICULTY,
  JEV_TRACK,
  jevDrivingState,
  jevInput,
  resolveTrack,
  type JevDecision,
  type JevPose,
  type JevUnavailableReason,
  type ReplayFrame,
  type ServerMessage,
  type Track,
} from "@racing/shared";
import { SPAWN_SAMPLE } from "./harness";
import type { CarInput } from "./input";
import type { JevRecordedDecision, JevRecording } from "./jev-recording";
import { CarPhysics } from "./physics";

/** The two answers a `jevDrive` can get. */
export type JevLiveAnswer = Extract<ServerMessage, { type: "jevDecision" | "jevUnavailable" }>;

/** Sends one `jevDrive` about `pose`; the answer comes back through `JevLiveRun.receive`. */
export type RequestJevDecision = (pose: JevPose, seq: number) => void;

/**
 * `asking` until Jev's first answer, then `driving`. A run ends `finished` with
 * a recording, `lost` when the watchdog gives up, or `unavailable` when the
 * server cannot reach Jev at all.
 */
export type JevLivePhase = "asking" | "driving" | "finished" | "lost" | "unavailable";

/** Why the car is holding its last input rather than a fresh decision. */
export type JevHoldReason = Exclude<JevUnavailableReason, "disabled"> | "timeout";

/** Jev's latest answer, with what it was shown. */
export interface JevLiveDecision {
  decision: JevDecision;
  model: string;
  /** `bend_ahead` for the predicted pose Jev judged. */
  seen: string;
  /** TypeSafe's own round trip as the server measured it. */
  latencyMs: number;
}

/** A TypeSafe round trip is about 240 ms; this seeds the estimate until Jev has answered. */
const INITIAL_ROUND_TRIP_MS = 250;
/** Weight of the newest round trip in the moving average the prediction uses. */
const ROUND_TRIP_WEIGHT = 0.25;
/** Abandon a request unanswered this long, so a lost message cannot stall the run. */
const REQUEST_TIMEOUT_MS = 3000;
/** Retry delays double from one decision interval per refusal in a row, up to this. */
const MAX_BACKOFF_MS = 2000;
/** Without reaching the next Checkpoint for this long, Jev is lost. */
const STALL_MS = 20_000;
/** A lap takes Jev about 37 s; a run this long has gone wrong. */
const MAX_RUN_MS = 120_000;
/** Recorded frames are at least this far apart: every frame at 60 Hz, fewer on faster displays. */
const FRAME_SPACING_MS = 15;
/** Below this speed (m/s) a run that has ended stops braking, or the car would reverse. */
const STOPPED_SPEED = 0.5;
const R2 = CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;

/** Unique per page, so an answer meant for an abandoned run never matches a newer request. */
let nextSeq = 1;

/**
 * One Jev Live Run without any DOM (ADR-0009): the car's real-time physics,
 * the request pipeline to Jev, lap timing and the recording. The viewer ticks it
 * every frame and routes the server's answers to `receive`.
 *
 * Exactly one request is in flight. Each asks about the pose the car is
 * predicted to have when the answer lands — the current input held for the
 * measured round trip — since a decision about where the car was arrives too
 * late to drive by. An answer takes effect on arrival and holds until the next;
 * a refused or lost request keeps the last input and retries after a backoff.
 *
 * Time is run time, the sum of the ticks while not paused, so a hidden tab never counts.
 */
export class JevLiveRun {
  readonly car: CarPhysics;
  /** The input in force: Jev's latest decision, held until the next one. */
  readonly input: CarInput = { throttle: 0, brake: 0, steer: 0 };
  phase: JevLivePhase = "asking";
  /** Set while the latest request was refused or timed out; cleared by the next decision. */
  holding: JevHoldReason | null = null;
  /** Decisions received this run. */
  decisions = 0;
  latest: JevLiveDecision | null = null;
  /** The timed lap, once finished. */
  recording: JevRecording | null = null;
  /** While paused (a hidden tab) the run stands still and asks nothing; answers still apply. */
  paused = false;
  /** Run time in ms. */
  timeMs = 0;

  private lapStart: number | null = null;
  private nextCheckpoint = 0;
  private progressAt = 0;
  private frames: ReplayFrame[] = [];
  private recorded: JevRecordedDecision[] = [];
  private lastFrameAt = 0;
  private pending: { seq: number; sentAt: number; pose: JevPose } | null = null;
  private lastSentAt = -Infinity;
  private retryAt = 0;
  private refusals = 0;
  private roundTripMs = INITIAL_ROUND_TRIP_MS;
  private roundTrips = 0;

  constructor(
    private readonly requestDecision: RequestJevDecision,
    private readonly track: Track = resolveTrack(JEV_TRACK),
  ) {
    this.car = new CarPhysics(JEV_DIFFICULTY, track.samples);
    this.restart();
  }

  /** Back to the spawn for a new run. The round-trip estimate carries over. */
  restart(): void {
    this.car.spawnAtSample(SPAWN_SAMPLE, 0);
    this.setInput(0, 0, 0);
    this.phase = "asking";
    this.holding = null;
    this.decisions = 0;
    this.latest = null;
    this.recording = null;
    this.timeMs = 0;
    this.lapStart = null;
    this.nextCheckpoint = 0;
    this.progressAt = 0;
    this.frames = [];
    this.recorded = [];
    this.lastFrameAt = 0;
    // An answer still on its way belongs to the old run and is ignored.
    this.pending = null;
    this.lastSentAt = -Infinity;
    this.retryAt = 0;
    this.refusals = 0;
  }

  /** How far ahead requests predict the car: the moving average of measured round trips. */
  get predictionMs(): number {
    return this.roundTripMs;
  }

  get ended(): boolean {
    return this.phase === "finished" || this.phase === "lost" || this.phase === "unavailable";
  }

  /** The running lap's time, the finished lap's, or null before the start line. */
  get lapTimeMs(): number | null {
    if (this.recording) return this.recording.timeMs;
    return this.lapStart === null || this.ended ? null : this.carTime - this.lapStart;
  }

  /** The car's physical state trails the run clock by the time it has not yet simulated. */
  private get carTime(): number {
    return this.timeMs - this.car.backlog * 1000;
  }

  /** Advance by one frame's wall time. */
  tick(elapsedSeconds: number): void {
    if (this.paused || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return;
    this.timeMs += elapsedSeconds * 1000;
    if (this.ended) {
      // Bring the car to rest behind the result instead of driving on.
      this.setInput(0, this.car.speed > STOPPED_SPEED ? 1 : 0, 0);
      this.car.advance(elapsedSeconds, this.input);
      return;
    }
    this.car.advance(elapsedSeconds, this.input);
    this.observeLap();
    if (!this.ended) this.pump();
  }

  /** Apply the server's answer to a `jevDrive`; any answer but the pending request's is stale. */
  receive(answer: JevLiveAnswer): void {
    const pending = this.pending;
    if (pending === null || answer.seq !== pending.seq) return;
    this.pending = null;
    if (answer.type === "jevUnavailable") {
      if (answer.reason === "disabled") this.end("unavailable");
      else this.refuse(answer.reason);
      return;
    }
    // Measured in run time, frame to frame: the simulated time between the pose the
    // prediction started from and this decision taking effect, which it must cover.
    const roundTrip = this.timeMs - pending.sentAt;
    // The first request also opens the TypeSafe connection; it would skew the estimate.
    if (this.roundTrips++ > 0)
      this.roundTripMs += (roundTrip - this.roundTripMs) * ROUND_TRIP_WEIGHT;
    const { accelerate, left, pedalConfidence, steerConfidence, model, latencyMs } = answer;
    const decision = { accelerate, left, pedalConfidence, steerConfidence };
    const { throttle, brake, steer } = jevInput(decision);
    this.setInput(throttle, brake, steer);
    this.decisions++;
    this.latest = {
      decision,
      model,
      seen: jevDrivingState(pending.pose, this.track).bend_ahead,
      latencyMs,
    };
    this.holding = null;
    this.refusals = 0;
    if (this.phase === "asking") this.phase = "driving";
    if (this.lapStart !== null) this.recordDecision(this.carTime - this.lapStart);
    // Ask again straight away, as far as the server's pace allows.
    this.pump();
  }

  private setInput(throttle: number, brake: number, steer: number): void {
    this.input.throttle = throttle;
    this.input.brake = brake;
    this.input.steer = steer;
  }

  /** Checkpoints, lap timing, the recording and the watchdog, on the car's physical state. */
  private observeLap(): void {
    const { checkpoints } = this.track;
    const cp = checkpoints[this.nextCheckpoint];
    const dx = this.car.x - cp.x;
    const dz = this.car.z - cp.z;
    if (dx * dx + dz * dz <= R2) {
      const crossed = this.nextCheckpoint;
      this.nextCheckpoint = (crossed + 1) % checkpoints.length;
      this.progressAt = this.timeMs;
      if (crossed === 0 && this.lapStart !== null) {
        this.finish();
        return;
      }
      if (crossed === 0) {
        this.lapStart = this.carTime;
        this.recordFrame(0);
        // The decision in force at the line drives the lap's first metres.
        if (this.latest) this.recordDecision(0);
        return;
      }
    }
    if (this.lapStart !== null) {
      const t = this.carTime - this.lapStart;
      if (t - this.lastFrameAt >= FRAME_SPACING_MS) this.recordFrame(t);
    }
    if (this.timeMs - this.progressAt > STALL_MS || this.timeMs > MAX_RUN_MS) this.end("lost");
  }

  private finish(): void {
    const timeMs = Math.round(this.carTime - this.lapStart!);
    this.recordFrame(timeMs);
    this.recording = {
      model: this.latest?.model ?? "",
      timeMs,
      frames: this.frames,
      decisions: this.recorded,
    };
    this.end("finished");
  }

  private end(phase: "finished" | "lost" | "unavailable"): void {
    this.phase = phase;
    this.holding = null;
    this.pending = null;
  }

  /** Rounded like the Reference Lap's frames. */
  private recordFrame(t: number): void {
    const { x, z, heading, speed } = this.car;
    this.lastFrameAt = t;
    this.frames.push([Math.round(t), round(x, 2), round(z, 2), round(heading, 3), round(speed, 2)]);
  }

  private recordDecision(t: number): void {
    const { accelerate, left, pedalConfidence, steerConfidence } = this.latest!.decision;
    this.recorded.push([Math.round(t), accelerate, left, pedalConfidence, steerConfidence]);
  }

  /** Time out a lost request, then ask again once nothing is in flight and the pace allows. */
  private pump(): void {
    if (this.pending && this.timeMs - this.pending.sentAt >= REQUEST_TIMEOUT_MS) {
      this.pending = null;
      this.refuse("timeout");
    }
    if (this.pending || this.paused || this.ended) return;
    // The server allows one decision per interval per connection; asking sooner is refused.
    if (this.timeMs < Math.max(this.lastSentAt + JEV_DECISION_INTERVAL_MS, this.retryAt)) return;
    const seq = nextSeq++;
    const pose = this.car.predict(this.roundTripMs / 1000, this.input);
    this.pending = { seq, sentAt: this.timeMs, pose };
    this.lastSentAt = this.timeMs;
    this.requestDecision(pose, seq);
  }

  private refuse(reason: JevHoldReason): void {
    this.holding = reason;
    this.retryAt =
      this.timeMs + Math.min(JEV_DECISION_INTERVAL_MS * 2 ** this.refusals, MAX_BACKOFF_MS);
    this.refusals++;
  }
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
