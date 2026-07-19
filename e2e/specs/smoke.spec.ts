import { expect, test } from "@playwright/test";

test("lobby renders the driver name input", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Driver")).toBeVisible();
});
