import type { Locator } from "@playwright/test";
import { type ReplayFrame, SUNSET_RIDGE } from "@racing/shared";
import { createRoom, joinRoom } from "../fixtures/lobby";
import { expect, test } from "../fixtures/players";

const PLAYER_A = "Player Alpha";
const PLAYER_B = "Player Bravo";
const PACER = "Pacer Pete";
const ROOM_NAME = "Knockout Room";
const PACER_LAP_MS = 20_000;

const frame = (t: number, { x, z }: { x: number; z: number }): ReplayFrame => [t, x, z, 0, 30];

/**
 * A recorded lap that hops from Checkpoint to Checkpoint and back to the line.
 * The server ranks a grid Pacer from the times its recording reaches each
 * Checkpoint, so nothing between them matters here.
 */
function pacerLap(): ReplayFrame[] {
  const { checkpoints } = SUNSET_RIDGE;
  return [
    ...checkpoints.map((cp, k) => frame(Math.round((k * PACER_LAP_MS) / checkpoints.length), cp)),
    frame(PACER_LAP_MS, checkpoints[0]),
  ];
}

const sortedNames = (names: Locator) => async () => (await names.allTextContents()).sort();

test("a Knockout seats a grid Pacer, a rejoining driver spectates, and the Room returns to free driving", async ({
  db,
  playerA,
  playerB,
}) => {
  // The only Replay on the Room's board fills one empty Grid slot.
  await db.seedBestLap({ name: PACER, timeMs: PACER_LAP_MS, frames: pacerLap() });

  await Promise.all([playerA.goto("/"), playerB.goto("/")]);
  await createRoom(playerA, { playerName: PLAYER_A, roomName: ROOM_NAME });
  await joinRoom(playerB, PLAYER_B, ROOM_NAME);
  for (const player of [playerA, playerB]) {
    const standings = player.locator(".hud-standings tbody");
    await expect(standings).toContainText(PLAYER_A);
    await expect(standings).toContainText(PLAYER_B);
  }

  await playerA.getByRole("button", { name: "Start knockout", exact: true }).click();

  // The countdown lasts three seconds, so both pages are watched at once.
  await Promise.all(
    [playerA, playerB].map((player) =>
      expect(player.locator(".race-countdown")).toHaveClass(/\bvisible\b/),
    ),
  );
  for (const player of [playerA, playerB]) {
    const standings = player.locator(".race-standings");
    await expect
      .poll(sortedNames(standings.locator(".rs-name")))
      .toEqual([PACER, PLAYER_A, PLAYER_B].sort());
    await expect(standings.locator("tr.pacer .rs-name")).toHaveText(PACER);
  }

  // Leaving the Room is a DNF; back in it, B has no car and watches the race.
  await playerB.getByRole("button", { name: "Leave race", exact: true }).click();
  await joinRoom(playerB, PLAYER_B, ROOM_NAME);
  await expect(playerB.locator(".spectator-banner")).toHaveClass(/\bvisible\b/);

  // A idles on the Grid, so when the Pacer completes lap 1 (20s after GO) A is
  // the only car still racing that has not, and is out. B went out first. The
  // results show for ten seconds, so both pages are watched at once.
  await Promise.all(
    [playerA, playerB].map(async (player) => {
      const results = player.locator(".race-results");
      await expect(results).toHaveClass(/\bvisible\b/, { timeout: 60_000 });
      await expect(results.locator("ol.race-results-list li .rr-name")).toHaveText([
        PACER,
        PLAYER_A,
        PLAYER_B,
      ]);
    }),
  );

  await expect(playerA.locator(".race-results")).not.toHaveClass(/\bvisible\b/, {
    timeout: 30_000,
  });
  await expect(playerA.getByRole("button", { name: "Start race", exact: true })).toBeVisible();
});
