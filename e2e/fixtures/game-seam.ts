import type { Page } from "@playwright/test";
import lapInputs from "../lap-inputs.json" with { type: "json" };
import { expect, test as dbTest } from "./db";

interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
}

export interface GameState {
  position: { x: number; z: number };
  rotation: number;
  velocity: number;
  checkpoint: number;
  lap: {
    laps: number;
    active: boolean;
    lastLapMs?: number | null;
    bestLapMs?: number | null;
  };
  remotePlayerIds: string[];
  frame: number;
  inputCount: number;
  injectionFinished: boolean;
  lapSubmitted: boolean;
  serverLapMs: number | null;
  serverLaps: number;
}

interface BrowserGameApi {
  inject(inputs: CarInput[], options?: { stepsPerFrame?: number }): void;
  state(): GameState;
  trajectory(): GameState[];
}

declare global {
  interface Window {
    __game?: BrowserGameApi;
  }
}

export interface CreateRaceOptions {
  playerName: string;
  roomName: string;
}

export interface DrivenLap {
  state: GameState;
  /** Distinct server-observed Checkpoints, including CP0 at both lap boundaries. */
  checkpoints: number[];
}

export interface GameSeamFixture {
  createRace(options: CreateRaceOptions): Promise<void>;
  driveLap(options?: { stepsPerFrame?: number }): Promise<DrivenLap>;
  state(): Promise<GameState>;
}

async function seamState(page: Page): Promise<GameState> {
  return page.evaluate(() => {
    if (!window.__game) throw new Error("window.__game is not installed");
    return window.__game.state();
  });
}

export const test = dbTest.extend<{ game: GameSeamFixture }>({
  game: async ({ page }, use) => {
    // Software WebGL cost scales with canvas size; this keeps full laps practical.
    await page.setViewportSize({ width: 320, height: 240 });

    const game: GameSeamFixture = {
      async createRace({ playerName, roomName }) {
        await page.goto("/");
        await page.getByLabel("Driver").fill(playerName);
        await page.getByPlaceholder("New room name").fill(roomName);
        await page.getByRole("button", { name: "Create & Race" }).click();
        await page.waitForFunction(() => window.__game !== undefined);
      },

      async driveLap({ stepsPerFrame = 1 } = {}) {
        await page.evaluate(
          ({ inputs, multiplier }) => {
            if (!window.__game) throw new Error("window.__game is not installed");
            window.__game.inject(inputs, { stepsPerFrame: multiplier });
          },
          { inputs: lapInputs, multiplier: stepsPerFrame },
        );

        await page.waitForFunction(
          () => window.__game?.state().injectionFinished === true,
          undefined,
          { timeout: 240_000 },
        );
        await page.waitForFunction(
          () => window.__game?.state().lapSubmitted === true,
          undefined,
          { timeout: 10_000 },
        );

        const [state, trajectory] = await Promise.all([
          seamState(page),
          page.evaluate(() => window.__game?.trajectory() ?? []),
        ]);
        const checkpoints = trajectory
          .map((sample) => sample.checkpoint)
          .filter((checkpoint, index, all) => index === 0 || checkpoint !== all[index - 1]);
        return { state, checkpoints };
      },

      state: () => seamState(page),
    };

    await use(game);
  },
});

export { expect };
