import type { Page, WebSocket } from "@playwright/test";
import {
  CAR_VARIANTS,
  dailyChallenge,
  resolveTrack,
  type DailyChallenge,
  type ServerMessage,
} from "@racing/shared";
import { expect, test } from "../fixtures/players";

const PLAYER_A = "Daily Alpha";
const PLAYER_B = "Daily Bravo";

/** Today's challenge as the server announced it, so a UTC rollover mid-test can't skew it. */
function challengeFromWelcome(page: Page): Promise<DailyChallenge> {
  return new Promise((resolve) => {
    page.on("websocket", (socket: WebSocket) => {
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(payload.toString()) as ServerMessage;
        if (message.type === "welcome" && message.daily) resolve(message.daily.challenge);
      });
    });
  });
}

async function variants(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() => {
    const state = window.__game?.state();
    return state && Object.values(state.variants);
  });
}

test("two drivers race the Daily from the Garage in one shared Daily Room", async ({
  playerA,
  playerB,
}) => {
  // Both drivers saved a car the Daily does not force, so forcing it is visible.
  const forced = dailyChallenge(Date.now()).variant;
  const ownCar = CAR_VARIANTS.find((variant) => variant !== forced)!;
  for (const [page, name] of [
    [playerA, PLAYER_A],
    [playerB, PLAYER_B],
  ] as const) {
    await page.addInitScript(
      ({ driver, car }) => {
        localStorage.setItem("racer-name", driver);
        localStorage.setItem("racer-variant", car);
      },
      { driver: name, car: ownCar },
    );
  }
  const challengePromise = challengeFromWelcome(playerA);
  await Promise.all([playerA.goto("/"), playerB.goto("/")]);
  const challenge = await challengePromise;

  for (const page of [playerA, playerB]) {
    const banner = page.getByRole("region", { name: "Daily Challenge" });
    await expect(banner).toContainText(`DAILY #${challenge.number}`);
    await expect(banner).toContainText(resolveTrack(challenge.track).name);
    await expect(banner).toContainText("No time yet today");
    await page.getByRole("button", { name: "Race the Daily" }).click();
  }

  for (const page of [playerA, playerB]) {
    await expect(page.locator(".hud-room")).toHaveText(`Daily #${challenge.number}`);
    const standings = page.locator(".hud-standings tbody");
    await expect(standings).toContainText(PLAYER_A);
    await expect(standings).toContainText(PLAYER_B);
    // Each driver's own car and the other's both render as the Daily's forced Variant.
    await expect
      .poll(() => variants(page), { timeout: 15_000 })
      .toEqual([challenge.variant, challenge.variant]);
  }
});
