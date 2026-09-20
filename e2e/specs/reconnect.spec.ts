import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "../fixtures/players";
import { openRaceSettings } from "../fixtures/lobby";
import { serverPort } from "../workers";

test("automatically reconnects after a dropped connection and another failed attempt", async ({
  playerA,
}, testInfo) => {
  let connection: WebSocketRoute | undefined;
  let attempts = 0;
  await playerA.routeWebSocket(
    (url) => url.port === String(serverPort(testInfo.parallelIndex)),
    async (socket) => {
      attempts++;
      if (attempts === 2) {
        await socket.close();
        return;
      }
      socket.connectToServer();
      connection = socket;
    },
  );
  await playerA.goto("/");
  await expect(playerA.locator(".connection-status")).toHaveText("LIVE MULTIPLAYER");
  await connection!.close();
  await expect.poll(() => attempts, { timeout: 10_000 }).toBe(3);
  await expect(playerA.locator(".connection-status")).toHaveText("LIVE MULTIPLAYER");
  await expect(playerA.locator(".connect-error")).toHaveCount(0);

  await openRaceSettings(playerA);
  await playerA.getByLabel("Driver").fill("Retry Driver");
  await playerA.getByPlaceholder("New room name").fill("Reconnected Room");
  await playerA.getByRole("button", { name: "Create & Race" }).click();
  await expect(playerA.locator(".hud-standings tbody")).toContainText("Retry Driver");
});
