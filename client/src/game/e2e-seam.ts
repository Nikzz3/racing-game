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
}

export interface E2eState extends E2eLocalState {
  remotePlayerIds: string[];
  frame: number;
  inputCount: number;
  injectionFinished: boolean;
  lapSubmitted: boolean;
  serverLapMs: number | null;
  serverLaps: number;
}

export interface E2eGameApi {
  inject(inputs: CarInput[], options?: { stepsPerFrame?: number }): void;
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
  private frame = 0;
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

  inject(inputs: CarInput[], options: { stepsPerFrame?: number } = {}): void {
    const multiplier = options.stepsPerFrame ?? 1;
    if (!Number.isInteger(multiplier) || multiplier < 1) {
      throw new RangeError("stepsPerFrame must be a positive integer");
    }
    this.inputs = inputs.map((input) => ({ ...input }));
    this.frame = 0;
    this.stepsPerFrame = multiplier;
    this.samples = [];
    this.serverLapMs = null;
    this.serverLaps = 0;
  }

  get driving(): boolean {
    return this.frame < this.inputs.length;
  }

  /** Advances at most one configured batch; the outer loop remains real-time rAF. */
  stepFrame(): number {
    let steps = 0;
    while (steps < this.stepsPerFrame && this.driving) {
      this.game.step(E2E_DT, this.inputs[this.frame]);
      this.frame++;
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
      frame: this.frame,
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
