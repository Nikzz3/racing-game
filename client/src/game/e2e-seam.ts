import type { Variant } from "@racing/shared";
import type { CarInput } from "./input";

export const E2E_DT = 1 / 60;

export interface E2eLocalState {
  position: { x: number; z: number };
  rotation: number;
  velocity: number;
  checkpoint: number;
  lap: { laps: number; active: boolean; lastLapMs?: number | null; bestLapMs?: number | null };
}

export interface E2eGameBindings {
  step(dt: number, input: CarInput): void;
  localState(): E2eLocalState;
  remotePlayerIds(): string[];
  /** Resolved (rendered) Variant per player id, local player included. */
  playerVariants(): Record<string, Variant>;
  /** Resolved Variant of the armed Pacer, or null when no Pacer is armed. */
  pacerVariant(): Variant | null;
}

export interface E2eState extends E2eLocalState {
  remotePlayerIds: string[];
  variants: Record<string, Variant>;
  pacerVariant: Variant | null;
  frame: number;
  inputCount: number;
  injectionFinished: boolean;
  lapSubmitted: boolean;
  serverLapMs: number | null;
  serverLaps: number;
}

export interface E2eInjectionOptions {
  stepsPerFrame?: number;
}

export interface E2eGameApi {
  inject(inputs: CarInput[], options?: E2eInjectionOptions): void;
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
  private stepsPerFrame = 1;
  private samples: E2eLocalState[] = [];
  private serverLapMs: number | null = null;
  private serverLaps = 0;
  private readonly api: E2eGameApi;

  constructor(private readonly game: E2eGameBindings) {
    this.api = {
      inject: (inputs, options) => this.inject(inputs, options),
      state: () => this.state(),
      trajectory: () => this.trajectory(),
    };
  }

  install(): void {
    window.__game = this.api;
  }

  inject(inputs: CarInput[], options: E2eInjectionOptions = {}): void {
    const stepsPerFrame = options.stepsPerFrame ?? 1;
    if (!Number.isInteger(stepsPerFrame) || stepsPerFrame < 1) {
      throw new RangeError("stepsPerFrame must be a positive integer");
    }

    this.inputs = inputs.map((input) => ({ ...input }));
    this.nextInputIndex = 0;
    this.stepsPerFrame = stepsPerFrame;
    this.samples = [];
    this.serverLapMs = null;
    this.serverLaps = 0;
  }

  get driving(): boolean {
    return this.nextInputIndex < this.inputs.length;
  }

  /**
   * Advances at most one configured batch, and no more than `budget` steps. The
   * server times laps off its own wall clock, so simulating faster than real time
   * yields a lap it rejects as implausible; the caller's budget holds the seam to
   * real time.
   */
  stepFrame(budget = Number.POSITIVE_INFINITY): number {
    const limit = Math.min(this.stepsPerFrame, budget);
    let steps = 0;
    while (steps < limit && this.driving) {
      const input = this.inputs[this.nextInputIndex];
      this.game.step(E2E_DT, input);
      this.nextInputIndex++;
      steps++;
      this.samples.push(structuredClone(this.game.localState()));
    }
    return steps;
  }

  recordLapSubmission(lapTimeMs: number, laps: number): void {
    this.serverLapMs = lapTimeMs;
    this.serverLaps = laps;
  }

  state(): E2eState {
    return {
      ...this.game.localState(),
      remotePlayerIds: [...this.game.remotePlayerIds()].sort(),
      variants: this.game.playerVariants(),
      pacerVariant: this.game.pacerVariant(),
      frame: this.nextInputIndex,
      inputCount: this.inputs.length,
      injectionFinished: !this.driving,
      lapSubmitted: this.serverLaps > 0,
      serverLapMs: this.serverLapMs,
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
