import type { Page } from "@playwright/test";
import type { E2eLocalState, E2eState } from "../../client/src/game/e2e-seam";
import type { CarInput } from "../../client/src/game/input";
import lapInputs from "../lap-inputs.json" with { type: "json" };
import { expect, test as dbTest } from "./db";
import { createRoom, type CreateRoomOptions } from "./lobby";

export type CreateRaceOptions = CreateRoomOptions;

export interface DrivenLap {
  state: E2eState;
  /** Distinct server-observed Checkpoints, including CP0 at both lap boundaries. */
  checkpoints: number[];
}

export interface GameSeamFixture {
  createRace(options: CreateRaceOptions): Promise<void>;
  /** Replays the inputs in the browser and resolves with the recorded trajectory. */
  driveInputs(inputs: CarInput[]): Promise<E2eLocalState[]>;
  driveLap(): Promise<DrivenLap>;
  state(): Promise<E2eState>;
}

async function seamState(page: Page): Promise<E2eState> {
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
      async createRace(options) {
        await page.goto("/");
        await createRoom(page, options);
        await page.waitForFunction(() => window.__game !== undefined);
      },

      async driveInputs(inputs) {
        await page.evaluate((inputs) => {
          if (!window.__game) throw new Error("window.__game is not installed");
          window.__game.inject(inputs);
        }, inputs);

        // The seam is held to real time, so a full lap's worth of inputs takes minutes.
        await page.waitForFunction(
          () => window.__game?.state().injectionFinished === true,
          undefined,
          { timeout: 240_000 },
        );

        return page.evaluate<E2eLocalState[]>(() => window.__game?.trajectory() ?? []);
      },

      async driveLap() {
        const trajectory = await game.driveInputs(lapInputs);

        await page.waitForFunction(
          () => window.__game?.state().lapSubmitted === true,
          undefined,
          { timeout: 10_000 },
        );

        const state = await seamState(page);
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
