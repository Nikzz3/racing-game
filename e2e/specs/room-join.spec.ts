import type { Page, WebSocket } from "@playwright/test";
import type { ServerMessage } from "@racing/shared";
import { createRoom } from "../fixtures/lobby";
import { expect, test } from "../fixtures/players";

const PLAYER_A = "Player Alpha";
const PLAYER_B = "Player Bravo";
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

test("two players create and join a Room and see each other", async ({ playerA, playerB }) => {
  const playerAIdPromise = playerIdFromWelcome(playerA);
  const playerBIdPromise = playerIdFromWelcome(playerB);

  await Promise.all([playerA.goto("/"), playerB.goto("/")]);
  const [playerAId, playerBId] = await Promise.all([playerAIdPromise, playerBIdPromise]);

  await createRoom(playerA, { playerName: PLAYER_A, roomName: ROOM_NAME });

  await playerB.getByLabel("Driver").fill(PLAYER_B);
  const room = playerB.locator(".room-row").filter({ hasText: ROOM_NAME });
  await expect(room).toContainText("1 racing");
  await room.getByRole("button", { name: "Join" }).click();

  for (const player of [playerA, playerB]) {
    const standings = player.locator(".hud-standings tbody");
    await expect(standings).toContainText(PLAYER_A);
    await expect(standings).toContainText(PLAYER_B);
  }

  await expect.poll(() => remotePlayerIds(playerA)).toEqual([playerBId]);
  await expect.poll(() => remotePlayerIds(playerB)).toEqual([playerAId]);
});
