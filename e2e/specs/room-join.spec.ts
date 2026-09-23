import type { Page, WebSocket } from "@playwright/test";
import type { ServerMessage } from "@racing/shared";
import { CAR_HALF_WIDTH } from "../../client/src/game/car-collision";
import { expect, test } from "../fixtures/players";
import { openRaceSettings, selectCar } from "../fixtures/lobby";

const PLAYER_A = "Player Alpha";
const PLAYER_B = "Player Bravo";
const PLAYER_A_VARIANT = "suv";
const PLAYER_B_VARIANT = "taxi";
const ROOM_NAME = "Two Player Room";

function playerIdFromWelcome(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.on("websocket", (socket: WebSocket) => {
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(payload.toString()) as ServerMessage;
        if (message.type === "welcome") {
          resolve(message.playerId);
        }
      });
    });
  });
}

async function remotePlayerIds(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() => window.__game?.state().remotePlayerIds);
}

/** How far apart this page draws its own car and the other player's. */
async function gapTo(page: Page, playerId: string): Promise<number | undefined> {
  return page.evaluate((id) => {
    const state = window.__game?.state();
    const other = state?.remotePositions[id];
    if (!state || !other) return undefined;
    return Math.hypot(state.position.x - other.x, state.position.z - other.z);
  }, playerId);
}

/** This page's Direct Link to a player, and the path it draws that player's car from. */
async function directLink(
  page: Page,
  playerId: string,
): Promise<{ link?: string; source?: string } | undefined> {
  return page.evaluate((id) => {
    const state = window.__game?.state();
    return state && { link: state.links[id], source: state.poseSources[id] };
  }, playerId);
}

async function resolvedVariant(page: Page, playerId: string): Promise<string | undefined> {
  return page.evaluate((id) => window.__game?.state().variants[id], playerId);
}

test("two players create and join a Room, see each other, and collide", async ({
  playerA,
  playerB,
}) => {
  const playerAIdPromise = playerIdFromWelcome(playerA);
  const playerBIdPromise = playerIdFromWelcome(playerB);

  // Player B chose the taxi Variant, seeded directly into the localStorage key
  // the Garage picker writes (player A exercises the picker UI itself below).
  await playerB.addInitScript(
    (variant) => localStorage.setItem("racer-variant", variant),
    PLAYER_B_VARIANT,
  );

  await Promise.all([playerA.goto("/"), playerB.goto("/")]);
  const [playerAId, playerBId] = await Promise.all([playerAIdPromise, playerBIdPromise]);

  // Player A picks their Variant with the Garage arrows; the selection writes the
  // same racer-variant key player B seeds directly above.
  const suvCard = playerA.locator(`.garage-card[data-variant="${PLAYER_A_VARIANT}"]`);
  await expect(suvCard).toBeVisible();
  await selectCar(playerA, PLAYER_A_VARIANT);
  await openRaceSettings(playerA);
  await playerA.getByLabel("Driver").fill(PLAYER_A);
  await playerA.getByPlaceholder("New room name").fill(ROOM_NAME);
  await playerA.getByRole("button", { name: "Create & Race" }).click();

  await openRaceSettings(playerB);
  await playerB.getByLabel("Driver").fill(PLAYER_B);
  const room = playerB.locator(".room-row").filter({ hasText: ROOM_NAME });
  await expect(room).toContainText("1 racing");
  await room.click();
  await playerB.getByRole("button", { name: "Join & Race" }).click();

  for (const player of [playerA, playerB]) {
    const standings = player.locator(".hud-standings tbody");
    await expect(standings).toContainText(PLAYER_A);
    await expect(standings).toContainText(PLAYER_B);
  }

  await expect.poll(() => remotePlayerIds(playerA)).toEqual([playerBId]);
  await expect.poll(() => remotePlayerIds(playerB)).toEqual([playerAId]);

  // The server relays the WebRTC negotiation, then each client draws the other's
  // car from poses arriving over the Direct Link (ADR-0009).
  await expect
    .poll(() => directLink(playerA, playerBId))
    .toEqual({ link: "direct", source: "direct" });
  await expect
    .poll(() => directLink(playerB, playerAId))
    .toEqual({ link: "direct", source: "direct" });

  // Under the e2e seam both cars spawn on the same grid slot. They collide rather
  // than drive through each other, so each client shoves its own car clear. Both
  // views are read together: until a player's first state arrives, the other
  // client draws them at the origin, far from the grid.
  await expect
    .poll(async () => {
      const gaps = await Promise.all([gapTo(playerA, playerBId), gapTo(playerB, playerAId)]);
      return Math.min(...gaps.map((gap) => gap ?? 0));
    })
    .toBeGreaterThanOrEqual(CAR_HALF_WIDTH * 2);

  // B's hello carried the taxi Variant; A's client renders B's car with it.
  await expect
    .poll(() => resolvedVariant(playerA, playerBId), { timeout: 15_000 })
    .toBe(PLAYER_B_VARIANT);

  // A's Garage pick drove their own car: the local resolved Variant is suv.
  await expect
    .poll(() => resolvedVariant(playerA, playerAId), { timeout: 15_000 })
    .toBe(PLAYER_A_VARIANT);

  // localStorage round-trip: after a reload the suv card renders as selected.
  await playerA.reload();
  await expect(suvCard).toHaveClass(/active/);
});
