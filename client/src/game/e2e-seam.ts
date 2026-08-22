import type { CarInput } from "./input";

export const E2E_DT = 1 / 60;

export interface E2eLocalState {
  position: { x: number; z: number };
  heading: number;
  speed: number;
  checkpoint: number;
  lap: { laps: number; active: boolean; lastLapMs?: number | null; bestLapMs?: number | null };
}

/**
 * Snapshot of the in-Room Pacer overlay. Pose-source-agnostic: identical for a
 * human Replay's fetched frames and the AI Record's baked frames, so both
 * journeys can assert through it.
 */
export interface E2ePacerState {
  /** Number of replay frames loaded (0 until they arrive). */
  frameCount: number;
  /** Playback has started (driver crossed the start line). */
  playing: boolean;
  /** The overlay car is currently visible in the scene. */
  visible: boolean;
  /** Opacity of the overlay car's least-translucent material (< 1 → translucent). */
  opacity: number;
}

export interface E2eGameBindings {
  step(dt: number, input: CarInput): void;
  localState(): E2eLocalState;
  remotePlayerIds(): string[];
  /** Pushes local state to the server; the seam paces these off simulated time. */
  sendState(): void;
  /** Current Pacer overlay state, or null when no Pacer is armed (or it was dismissed). */
  pacerState(): E2ePacerState | null;
}

export interface E2eState extends E2eLocalState {
  remotePlayerIds: string[];
  pacer: E2ePacerState | null;
  injectionFinished: boolean;
  lapSubmitted: boolean;
  serverLaps: number;
}

export interface E2eGameApi {
  inject(inputs: CarInput[]): void;
  state(): E2eState;
  trajectory(): E2eLocalState[];
}

declare global {
  interface Window {
    __game?: E2eGameApi;
  }
}

export class E2eSeam {
  private inputs: CarInput[] = [];
  private nextInputIndex = 0;
  private samples: E2eLocalState[] = [];
  private serverLaps = 0;
  /** Real seconds accrued toward the next fixed-step advance. */
  private stepAccumS = 0;
  /** Simulated ms accrued toward the next state send. */
  private sendAccumMs = 0;
  private readonly api: E2eGameApi;

  constructor(
    private readonly game: E2eGameBindings,
    private readonly sendIntervalMs: number,
  ) {
    this.api = {
      inject: (inputs) => this.inject(inputs),
      state: () => this.state(),
      trajectory: () => this.trajectory(),
    };
  }

  install(): void {
    window.__game = this.api;
  }

  inject(inputs: CarInput[]): void {
    this.inputs = inputs.map((input) => ({ ...input }));
    this.nextInputIndex = 0;
    this.samples = [];
    this.serverLaps = 0;
    this.stepAccumS = 0;
    this.sendAccumMs = 0;
  }

  get driving(): boolean {
    return this.nextInputIndex < this.inputs.length;
  }

  /**
   * Advances at most `budget` fixed steps. There is deliberately no fast-forward
   * multiplier: the server times laps off its own wall clock, so simulating faster
   * than real time yields a lap it rejects as implausible. The caller's budget,
   * spent from real elapsed time, is what holds the seam to real time.
   */
  stepFrame(budget: number): number {
    let steps = 0;
    while (steps < budget && this.driving) {
      const input = this.inputs[this.nextInputIndex];
      this.game.step(E2E_DT, input);
      this.nextInputIndex++;
      steps++;
      this.samples.push(structuredClone(this.game.localState()));
    }
    return steps;
  }

  /**
   * Spends `elapsedSeconds` of real time on the fixed-step schedule and returns the
   * simulated time those steps covered, so the caller's visual systems advance by
   * what was simulated rather than by wall clock. State sends are paced off that
   * same simulated time, keeping the server's sample spacing (and so its checkpoint
   * proximity checks) independent of how fast the client renders.
   */
  advance(elapsedSeconds: number): number {
    this.stepAccumS += elapsedSeconds;
    const steps = this.stepFrame(Math.floor(this.stepAccumS / E2E_DT));
    this.stepAccumS -= steps * E2E_DT;

    const dt = steps * E2E_DT;
    this.sendAccumMs += dt * 1000;
    while (this.sendAccumMs >= this.sendIntervalMs) {
      this.sendAccumMs -= this.sendIntervalMs;
      this.game.sendState();
    }
    return dt;
  }

  recordLapSubmission(laps: number): void {
    this.serverLaps = laps;
  }

  state(): E2eState {
    return {
      ...this.game.localState(),
      remotePlayerIds: [...this.game.remotePlayerIds()].sort(),
      pacer: this.game.pacerState(),
      injectionFinished: !this.driving,
      lapSubmitted: this.serverLaps > 0,
      serverLaps: this.serverLaps,
    };
  }

  trajectory(): E2eLocalState[] {
    return structuredClone(this.samples);
  }

  dispose(): void {
    if (window.__game === this.api) delete window.__game;
  }
}
