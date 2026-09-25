import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures/db";
import { openRaceSettings } from "../fixtures/lobby";

/** The number a counter element shows. */
async function count(locator: Locator): Promise<number> {
  return Number(await locator.textContent());
}

test.describe("Jev Live Run", () => {
  test("watches Jev drive live from the Records panel and exits to the lobby", async ({ page }) => {
    // Red until the server answers `jevDrive` with the JEV_STUB=1 stand-in: before
    // that `welcome.jev` is false and the lobby never offers the live run.
    test.fail();
    // Software WebGL cost scales with canvas size.
    await page.setViewportSize({ width: 320, height: 240 });
    await page.goto("/");
    await openRaceSettings(page);
    await page.locator('[data-setup-tab="records"]').click();
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
