import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures/db";
import { openSetupTab } from "../fixtures/lobby";

/** The number a counter element shows. */
async function count(locator: Locator): Promise<number> {
  return Number(await locator.textContent());
}

test.describe("Jev Lap", () => {
  test("replays the bundled Jev Lap with Jev's decisions alongside", async ({ page }) => {
    await page.goto("/");
    await openSetupTab(page, "records");
    const watch = page.locator("button[data-jev-lap]");
    await expect(watch).toHaveText(/^▶ Watch Jev Lap · \d:\d\d\.\d{3}$/);
    await watch.click();

    const hud = page.locator(".replay-hud");
    await expect(hud.locator(".replay-name")).toHaveText("Jev");
    const panel = hud.locator(".jev-panel");
    await expect(panel).toBeVisible();
    // Playback follows the wall clock and Jev decided every 100 ms of the lap,
    // so the count climbs even at software WebGL's few frames per second.
    await expect.poll(() => count(panel.locator("[data-jev-decisions]"))).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Exit replay" }).click();
    await expect(hud).toHaveCount(0);
    await expect(watch).toBeVisible();
  });
});
