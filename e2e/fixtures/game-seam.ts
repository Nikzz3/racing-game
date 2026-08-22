import type { Page } from "@playwright/test";
import type {
  E2eInjectionOptions,
  E2eLocalState,
  E2eState,
} from "../../client/src/game/e2e-seam";
import lapInputs from "../lap-inputs.json" with { type: "json" };
import { expect, test as dbTest } from "./db";

export interface CreateRaceOptions {
  playerName: string;
  roomName: string;
  /**
   * Option value to arm in the Starting Grid Pacer picker before creating the
   * Room: "ai" for the AI Record, or a human row's numeric index value.
   */
  pacer?: string;
}

export interface DrivenLap {
  state: E2eState;
  /** Distinct server-observed Checkpoints, including CP0 at both lap boundaries. */
  checkpoints: number[];
}

export interface GameSeamFixture {
  createRace(options: CreateRaceOptions): Promise<void>;
  driveLap(options?: E2eInjectionOptions): Promise<DrivenLap>;
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
      async createRace({ playerName, roomName, pacer }) {
        await page.goto("/");
        await page.getByLabel("Driver").fill(playerName);
        if (pacer !== undefined) await page.locator(".pacer-select").selectOption(pacer);
        await page.getByPlaceholder("New room name").fill(roomName);
        await page.getByRole("button", { name: "Create & Race" }).click();
        await page.waitForFunction(() => window.__game !== undefined);
      },

      async driveLap({ stepsPerFrame = 1 } = {}) {
        await page.evaluate(
          ({ inputs, stepsPerFrame }) => {
            if (!window.__game) throw new Error("window.__game is not installed");
            window.__game.inject(inputs, { stepsPerFrame });
          },
          { inputs: lapInputs, stepsPerFrame },
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
          page.evaluate<E2eLocalState[]>(() => window.__game?.trajectory() ?? []),
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
