import { SUNSET_RIDGE } from "@racing/shared";
import { expect, test } from "../fixtures/game-seam";

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

  const accepted = await db.query<{ name: string }>(
    "SELECT name FROM best_laps WHERE name = $1 AND track = $2 AND difficulty = $3",
    [playerName, "sunset-ridge", "medium"],
  );
  expect(accepted.rows).toEqual([{ name: playerName }]);
});

test("real keyboard input crosses the first Checkpoint", async ({ game, page }) => {
  await game.createRace({ playerName: "key-driver", roomName: "keyboard-smoke" });

  await page.keyboard.down("KeyW");
  await expect.poll(() => game.state().then((state) => state.checkpoint)).toBe(1);
  await page.keyboard.up("KeyW");
});
