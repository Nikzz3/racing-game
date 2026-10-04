import { TRACKS } from "@racing/shared";
import { CheckpointTracker, runRacingLineLap } from "../../client/src/game/harness";
import { expect, test } from "../fixtures/game-seam";
import { createRoom } from "../fixtures/lobby";

/** Gates the car drives past after the start line before the check. */
const GATES_PAST_START = 2;

/** Racing-line inputs from the grid until the car has passed the start line and two more gates. */
function inputsThroughStart(track: (typeof TRACKS)[number]) {
  const run = runRacingLineLap({ track })!;
  const tracker = new CheckpointTracker(track.checkpoints);
  const end = run.trajectory.findIndex(
    ({ x, z }, step) => (tracker.update(x, z, step), tracker.next > GATES_PAST_START),
  );
  // Half a second more so the last position reaches the server.
  return run.inputs.slice(0, end + 30);
}

// Every Track through the real client and server: crossing the start line starts the
// lap timer and the server counts the Checkpoints after it. A new Track the server does
// not know, or whose gates miss the road, fails here before a player finds it.
for (const track of TRACKS) {
  test(`${track.name} starts the lap timer at the line and counts its checkpoints`, async ({
    game,
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Select car", exact: true }).click();
    await page.locator(`.track-card[data-track="${track.id}"]`).click();
    await createRoom(page, { playerName: "starter", roomName: `start-${track.id}` });
    await page.waitForFunction(() => window.__game !== undefined);

    await game.driveInputs(inputsThroughStart(track));

    await expect.poll(() => game.state().then((s) => s.lap.active)).toBe(true);
    await expect
      .poll(() => game.state().then((s) => s.checkpoint))
      .toBe(GATES_PAST_START + 1);
  });
}
