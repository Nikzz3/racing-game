import type { Locator } from "@playwright/test";
import { type ReplayFrame, SUNSET_RIDGE } from "@racing/shared";
import { createRoom, joinRoom } from "../fixtures/lobby";
import { expect, test } from "../fixtures/players";

const PLAYER_A = "Player Alpha";
const PLAYER_B = "Player Bravo";
const PACER = "Pacer Pete";
const ROOM_NAME = "Knockout Room";
/** Long enough that the race is still running however slowly CI drives the pages. */
const PACER_LAP_MS = 120_000;

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

  // The Grid seats both drivers and the Pacer. The countdown itself is too brief
  // to catch reliably under software WebGL; vitest covers it.
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
  await expect(playerB.locator(".spectator-banner")).toHaveClass(/\bvisible\b/, {
    timeout: 60_000,
  });

  // A leaves too. With no driver left racing the server plays the Pacer's lap out
  // at once, so it wins; A went out after B, so A ranks ahead. The results show for
  // ten seconds, so B is watching for them before A's click lands.
  const results = playerB.locator(".race-results");
  const resultsShown = expect(results).toHaveClass(/\bvisible\b/, { timeout: 60_000 });
  await playerA.getByRole("button", { name: "Leave race", exact: true }).click();
  await resultsShown;
  await expect(results.locator("ol.race-results-list li .rr-name")).toHaveText([
    PACER,
    PLAYER_A,
    PLAYER_B,
  ]);

  // Then the Room is back to free driving, and B drives again.
  await expect(results).not.toHaveClass(/\bvisible\b/, { timeout: 60_000 });
  await expect(playerB.locator(".spectator-banner")).not.toHaveClass(/\bvisible\b/);
  await expect(playerB.getByRole("button", { name: "Start race", exact: true })).toBeVisible();
});
