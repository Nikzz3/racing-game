import type { Page, WebSocket } from "@playwright/test";
import { expect, test } from "../fixtures/players";

const PLAYER_A = "Player Alpha";
const PLAYER_B = "Player Bravo";
const PLAYER_B_VARIANT = "taxi";
const ROOM_NAME = "Two Player Room";

interface WelcomeMessage {
  type: "welcome";
  playerId: string;
}

function playerIdFromWelcome(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.on("websocket", (socket: WebSocket) => {
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(payload.toString()) as Partial<WelcomeMessage>;
        if (message.type === "welcome" && typeof message.playerId === "string") {
          resolve(message.playerId);
        }
      });
    });
  });
}

async function remotePlayerIds(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() => window.__game?.state().remotePlayerIds);
}

async function resolvedVariant(page: Page, playerId: string): Promise<string | undefined> {
  return page.evaluate(
    (id) =>
      (window.__game?.state() as { variants?: Record<string, string> } | undefined)?.variants?.[
        id
      ],
    playerId,
  );
}

test("two players create and join a Room and see each other", async ({ playerA, playerB }) => {
  // Red bookend for the Variant wire (#124): remove once the Variant travels
  // hello → snapshot → remote mesh and this journey goes green.
  test.fail();

  const playerAIdPromise = playerIdFromWelcome(playerA);
  const playerBIdPromise = playerIdFromWelcome(playerB);

  // Player B chose the taxi Variant; the Garage picker (follow-up issue #125)
  // will write this same localStorage key.
  await playerB.addInitScript((variant) => localStorage.setItem("racer-variant", variant), PLAYER_B_VARIANT);

  await Promise.all([playerA.goto("/"), playerB.goto("/")]);
  const [playerAId, playerBId] = await Promise.all([playerAIdPromise, playerBIdPromise]);

  await playerA.getByLabel("Driver").fill(PLAYER_A);
  await playerA.getByPlaceholder("New room name").fill(ROOM_NAME);
  await playerA.getByRole("button", { name: "Create & Race" }).click();

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

  // B's hello carried the taxi Variant; A's client renders B's car with it.
  await expect
    .poll(() => resolvedVariant(playerA, playerBId), { timeout: 15_000 })
    .toBe(PLAYER_B_VARIANT);
});
