import {
  CHECKPOINT_PENALTY_MS,
  COUNTDOWN_MS,
  GRACE_MS,
  GRID_SIZE,
  pacerCheckpointTimes,
  RACE_LAPS,
  RESULTS_MS,
  type EntrantStatus,
  type RaceEntrant,
  type RaceFormat,
  type RacePacer,
  type RacePhase,
  type RaceState,
  type ReplayFrame,
  type Track,
  type Variant,
} from "@racing/shared";
import type { TimingState } from "./timing";

/** A persisted human Replay that may take an empty grid slot. */
export interface PacerReplay {
  name: string;
  frames: ReplayFrame[];
  variant?: Variant;
}

/** A recording's lap time: its last frame is back on the line. */
const lapMs = (frames: ReplayFrame[]): number => frames.at(-1)?.[0] ?? 0;

/**
 * The Pacers for a grid's empty slots, up to GRID_SIZE cars: `replays` in the
 * order given (the board's fastest first), skipping any recorded under a
 * driver entrant's name.
 */
export function gridPacers(
  driverNames: readonly string[],
  replays: readonly PacerReplay[],
): RacePacer[] {
  const seated = new Set(driverNames);
  return replays
    .filter(({ name, frames }) => !seated.has(name) && lapMs(frames) > 0)
    .slice(0, Math.max(0, GRID_SIZE - driverNames.length))
    .map(({ name, frames, variant }, i) => ({ id: `pacer:${i + 1}`, name, frames, variant }));
}

/** A Pacer's recorded lap, as the race reads it. */
interface PacerLap {
  ms: number;
  /** Lap time at which each Checkpoint after the line is first reached, in order. */
  checkpointMs: number[];
}

function pacerLap(frames: ReplayFrame[], track: Track): PacerLap {
  const [, ...afterLine] = pacerCheckpointTimes(frames, track.checkpoints);
  return { ms: lapMs(frames), checkpointMs: afterLine.filter((ms) => ms !== null) };
}

interface Entrant extends Omit<RaceEntrant, "pacer" | "laps"> {
  /** When each lap since GO was completed; its length is the laps completed. */
  lapT: number[];
  /** Checkpoints passed since GO, and when that count was reached: what positions rank by. */
  progress: number;
  progressT: number;
  /** When it went out; among equal progress the later out ranks ahead. */
  outT?: number;
  /** Set for a Pacer: the recording its progress follows. */
  lap?: PacerLap;
  /** A driver's session count of missed Checkpoints at GO; only misses after it are paid. */
  missedAtGo?: number;
  /** When a driver's completed laps count, once their Checkpoint Penalties are served. */
  servingT: number[];
}

const STANDING: Record<EntrantStatus, number> = { finished: 0, racing: 1, out: 2 };

/**
 * Finished by time, then racing by progress, then out by the progress they
 * went out with, the later out ahead; equal progress goes to whoever reached
 * it first. Grid order settles anything left.
 */
function byPosition(a: Entrant, b: Entrant): number {
  return (
    STANDING[a.status] - STANDING[b.status] ||
    (a.finishMs ?? 0) - (b.finishMs ?? 0) ||
    b.progress - a.progress ||
    (b.outT ?? 0) - (a.outT ?? 0) ||
    a.progressT - b.progressT
  );
}

/** Of cars that have all completed lap k, the one that did last; the one further back on the grid on a tie. */
function lastToComplete(cars: Entrant[], k: number): Entrant {
  return cars.reduce((last, car) => (car.lapT[k - 1] >= last.lapT[k - 1] ? car : last));
}

/**
 * One race in a Room, as a state machine over injected time: it seats the
 * grid, counts down to GO, ranks every entrant by progress, applies the
 * format's finish, elimination and grace rules, then shows results. Drivers
 * progress through the timing their states produce; Pacers through their
 * recordings, which lets the machine play a field of Pacers out ahead of the
 * clock once no driver is left racing.
 */
export class Race {
  /** Server time of GO. */
  readonly goT: number;
  /** Laps to finish: RACE_LAPS, or in a Knockout one per elimination. */
  readonly laps: number;
  private currentPhase: RacePhase = "countdown";
  /** The grace period's end while racing, or the results screen's end. */
  private deadlineT: number | undefined;
  /** The Knockout lap whose last car goes out next. */
  private knockoutLap = 1;
  /** The time the machine has reached; ahead of the clock once the Pacers were played out. */
  private t: number;
  private readonly checkpoints: number;
  /** In grid order. */
  private readonly entrants: Entrant[];

  constructor(
    readonly format: RaceFormat,
    track: Track,
    drivers: readonly { id: string; name: string }[],
    /** The grid's Pacers, as every driver in the Room is sent them. */
    readonly pacers: RacePacer[],
    now: number,
  ) {
    this.goT = now + COUNTDOWN_MS;
    this.t = now;
    this.checkpoints = track.checkpoints.length;
    const seated: Pick<Entrant, "id" | "name" | "lap">[] = [
      ...drivers.map(({ id, name }) => ({ id, name })),
      ...pacers.map(({ id, name, frames }) => ({ id, name, lap: pacerLap(frames, track) })),
    ];
    this.entrants = seated.map((entrant, slot) => ({
      ...entrant,
      slot,
      status: "racing",
      lapT: [],
      servingT: [],
      progress: 0,
      progressT: now,
    }));
    this.laps = format === "race" ? RACE_LAPS : this.entrants.length - 1;
  }

  get phase(): RacePhase {
    return this.currentPhase;
  }

  /** Whether `id` is a car still racing; everyone else in the Room is a Spectator, with no car. */
  isRacing(id: string): boolean {
    return this.entrants.some((entrant) => entrant.id === id && entrant.status === "racing");
  }

  /**
   * A driver entrant's timing after one of its states landed: its progress,
   * and its finish once it completes the race's laps. Ignored before GO, and
   * once the driver has finished or is out. Checkpoint Penalties run the
   * driver's race clock behind: a completed lap counts only once the penalties
   * missed since GO are served, and progress ties go against it by as much
   * (ADR-0012).
   */
  driverProgress(
    id: string,
    timing: Pick<TimingState, "laps" | "next" | "lapStartT" | "missedCheckpoints">,
    now: number,
  ): void {
    const driver = this.driver(id);
    if (!driver) return;
    // The Pacers' laps up to now come first, so a tie at the line is decided in order.
    this.advance(now);
    if (this.currentPhase !== "racing" || driver.status !== "racing") return;
    // Exact: the grid owes the line and timing ignores states before GO, so this
    // first state after it cannot have missed a gate.
    driver.missedAtGo ??= timing.missedCheckpoints;
    const servedT = this.t + (timing.missedCheckpoints - driver.missedAtGo) * CHECKPOINT_PENALTY_MS;
    while (driver.lapT.length + driver.servingT.length < timing.laps) driver.servingT.push(servedT);
    while (driver.servingT.length && driver.servingT[0] <= this.t)
      driver.lapT.push(driver.servingT.shift()!);
    const n = this.checkpoints;
    const inLap = timing.lapStartT === null ? 0 : timing.next === 0 ? n : timing.next;
    const progress = timing.laps * n + inLap;
    if (progress !== driver.progress) {
      driver.progress = progress;
      driver.progressT = servedT;
    }
    this.advance(now);
  }

  /** A driver entrant left the Room: out (DNF) if still racing. */
  leave(id: string, now: number): void {
    const driver = this.driver(id);
    if (!driver) return;
    this.advance(now);
    if (driver.status !== "racing") return;
    this.out(driver, this.t);
    this.advance(now);
  }

  /** Advance to `now`: the state to publish, or null once the results have shown. */
  tick(now: number): RaceState | null {
    this.advance(now);
    if (this.currentPhase === "results" && now >= this.deadlineT!) return null;
    return {
      format: this.format,
      phase: this.currentPhase,
      laps: this.laps,
      goT: this.goT,
      deadlineT: this.deadlineT,
      entrants: [...this.entrants].sort(byPosition).map((entrant) => ({
        id: entrant.id,
        name: entrant.name,
        pacer: entrant.lap ? true : undefined,
        slot: entrant.slot,
        laps: entrant.lapT.length,
        status: entrant.status,
        finishMs: entrant.finishMs,
      })),
    };
  }

  /**
   * Play every event up to `now` in order. With no driver left racing, nothing
   * can change how the Pacers' recordings play out, so play them to the end.
   */
  private advance(now: number): void {
    if (this.currentPhase === "results") return;
    for (let t = this.nextEventT(); t <= now; t = this.nextEventT()) this.step(t);
    this.step(Math.max(now, this.t));
    while (!this.entrants.some((e) => !e.lap && e.status === "racing")) {
      const t = this.nextEventT();
      if (!Number.isFinite(t)) break;
      this.step(t);
    }
    if (this.currentPhase === "racing" && !this.racing().length) {
      this.currentPhase = "results";
      this.deadlineT = now + RESULTS_MS;
    }
  }

  /** When GO, a Pacer's lap or the deadline next changes the race; Infinity if nothing will. */
  private nextEventT(): number {
    if (this.currentPhase === "countdown") return this.goT;
    const racing = this.racing();
    if (this.currentPhase !== "racing" || !racing.length) return Infinity;
    let next = this.deadlineT !== undefined && this.deadlineT > this.t ? this.deadlineT : Infinity;
    for (const { lap, lapT } of racing) {
      if (lap && lapT.length < this.laps)
        next = Math.min(next, this.pacerLapT(lap, lapT.length + 1));
    }
    return next;
  }

  private step(t: number): void {
    this.t = t;
    if (this.currentPhase === "countdown" && t >= this.goT) this.currentPhase = "racing";
    if (this.currentPhase !== "racing") return;
    for (const entrant of this.racing()) if (entrant.lap) this.drivePacer(entrant, entrant.lap, t);
    if (this.format === "race") this.raceRules(t);
    else this.knockoutRules(t);
  }

  /** When a Pacer completes lap k, looping its recording from the line at GO. */
  private pacerLapT(lap: PacerLap, k: number): number {
    return this.goT + k * lap.ms;
  }

  /** A Pacer's laps and progress at `t`, straight from its recording. */
  private drivePacer(pacer: Entrant, lap: PacerLap, t: number): void {
    while (pacer.lapT.length < this.laps && this.pacerLapT(lap, pacer.lapT.length + 1) <= t) {
      pacer.lapT.push(this.pacerLapT(lap, pacer.lapT.length + 1));
    }
    const lapStartT = this.pacerLapT(lap, pacer.lapT.length);
    const passed = lap.checkpointMs.filter((ms) => lapStartT + ms <= t);
    pacer.progress = pacer.lapT.length * this.checkpoints + 1 + passed.length;
    pacer.progressT = lapStartT + (passed.at(-1) ?? 0);
  }

  /** Race: completing the laps finishes; the first finish gives the rest GRACE_MS. */
  private raceRules(t: number): void {
    for (const entrant of this.racing()) {
      if (entrant.lapT.length < this.laps) continue;
      const finishT = entrant.lapT[this.laps - 1];
      this.finish(entrant, finishT);
      this.deadlineT = Math.min(this.deadlineT ?? Infinity, finishT + GRACE_MS);
    }
    if (this.deadlineT === undefined || t < this.deadlineT) return;
    for (const entrant of this.racing()) this.out(entrant, this.deadlineT);
  }

  /**
   * Knockout: once all cars still racing but one have completed the current
   * lap, that one is out; otherwise whoever has not completed it GRACE_MS
   * after the first car did is out. The last car still racing wins.
   */
  private knockoutRules(t: number): void {
    for (;;) {
      const racing = this.racing();
      if (racing.length === 1) this.finish(racing[0], t);
      if (racing.length <= 1) break;
      const k = this.knockoutLap;
      const behind = racing.filter((car) => car.lapT.length < k);
      const deadline = this.knockoutDeadline(k);
      // None behind: the car that was has left, or the leaders lapped on
      // while the lap before waited out its grace; the last to complete it goes.
      if (behind.length <= 1) this.out(behind[0] ?? lastToComplete(racing, k), t);
      else if (deadline !== undefined && t >= deadline) {
        for (const car of behind) this.out(car, deadline);
      } else break;
      this.knockoutLap++;
    }
    this.deadlineT = this.knockoutDeadline(this.knockoutLap);
  }

  /**
   * GRACE_MS after the first car still racing completed Knockout lap k;
   * undefined until one has. A car that completed it and then left starts no
   * clock, or the grace could run out on every car left racing.
   */
  private knockoutDeadline(k: number): number | undefined {
    const first = Math.min(
      ...this.racing().map((car) => (car.lapT.length >= k ? car.lapT[k - 1] : Infinity)),
    );
    return Number.isFinite(first) ? first + GRACE_MS : undefined;
  }

  private finish(entrant: Entrant, t: number): void {
    entrant.status = "finished";
    entrant.finishMs = t - this.goT;
  }

  private out(entrant: Entrant, t: number): void {
    entrant.status = "out";
    entrant.outT = t;
  }

  private racing(): Entrant[] {
    return this.entrants.filter((entrant) => entrant.status === "racing");
  }

  private driver(id: string): Entrant | undefined {
    return this.entrants.find((entrant) => entrant.id === id && !entrant.lap);
  }
}
