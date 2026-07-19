import { SUNSET_RIDGE } from "@racing/shared";
import type { E2eLocalState } from "../../client/src/game/e2e-seam";
import { expect, test } from "../fixtures/game-seam";
import lapInputs from "../lap-inputs.json" with { type: "json" };

/**
 * A prefix of the recorded lap: long enough to cover launch and a corner, short
 * enough that replaying it twice at real-time pace stays inside the e2e budget.
 */
const DETERMINISM_INPUTS = lapInputs.slice(0, 240);

/** The physics half of a sample; the rest of the state is fed by server snapshots. */
function motion(trajectory: E2eLocalState[]) {
  return trajectory.map(({ position, heading, speed }) => ({ position, heading, speed }));
}

test("drives a server-accepted Plausible Lap through every Checkpoint in order", async ({
  db,
  game,
}) => {
  const playerName = "lap-driver";
  await game.createRace({ playerName, roomName: "valid-lap" });

  const result = await game.driveLap();

  expect(result.state.injectionFinished).toBe(true);
  expect(result.state.lapSubmitted).toBe(true);
  expect(result.state.serverLaps).toBe(1);
  expect(result.checkpoints).toEqual([
    ...SUNSET_RIDGE.checkpoints.map((_, index) => index),
    0,
  ]);

  const accepted = await db.bestLapFor(playerName);
  expect(accepted.map((lap) => lap.name)).toEqual([playerName]);
});

test("replays the same inputs to an exactly equal trajectory in the browser", async ({ game }) => {
  // Same CarInput[], two fresh races in the same Chromium: the car's motion must
  // match bit for bit, or a recorded lap means nothing when it is replayed.
  await game.createRace({ playerName: "determinism-driver", roomName: "determinism-a" });
  const first = await game.driveInputs(DETERMINISM_INPUTS);

  await game.createRace({ playerName: "determinism-driver", roomName: "determinism-b" });
  const second = await game.driveInputs(DETERMINISM_INPUTS);

  expect(first).toHaveLength(DETERMINISM_INPUTS.length);
  expect(motion(second)).toEqual(motion(first));
});

test("real keyboard input crosses the first Checkpoint", async ({ game, page }) => {
  await game.createRace({ playerName: "key-driver", roomName: "keyboard-smoke" });

  await page.keyboard.down("KeyW");
  await expect.poll(() => game.state().then((state) => state.checkpoint)).toBe(1);
  await page.keyboard.up("KeyW");
});
