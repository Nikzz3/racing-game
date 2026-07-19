import { expect, test } from "../fixtures/db";

test("lobby renders the driver name input", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Driver")).toBeVisible();
});
