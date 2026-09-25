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

test.describe("Jev Live Run", () => {
  test("watches Jev drive live from the Records panel and exits to the lobby", async ({ page }) => {
    // Software WebGL cost scales with canvas size.
    await page.setViewportSize({ width: 320, height: 240 });
    await page.goto("/");
    await openSetupTab(page, "records");
    // The e2e server runs Jev on the JEV_STUB=1 stand-in, so `welcome.jev` offers the run.
    const live = page.getByRole("button", { name: "● Watch Jev drive live" });
    await expect(live).toBeVisible();
    await live.click();

    // The panel appears with Jev's first answer; the stub answers one per decision interval.
    await expect(page.locator(".jev-panel")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => count(page.locator("[data-jev-decisions]")), { timeout: 20_000 })
      .toBeGreaterThan(3);
    await expect.poll(() => count(page.locator("[data-live-speed]"))).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page.locator(".jev-panel")).toHaveCount(0);
    await expect(live).toBeVisible();
  });
});
