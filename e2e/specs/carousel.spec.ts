import { expect, test } from "../fixtures/db";
import { selectCar } from "../fixtures/lobby";

test("selects a car through the carousel before configuring a race", async ({ page }) => {
  await page.goto("/");
  const selectedCar = page.locator(".garage-card.active");
  const next = page.getByRole("button", { name: "Next car", exact: true });
  const previous = page.getByRole("button", { name: "Previous car", exact: true });
  const select = page.getByRole("button", { name: "Select car", exact: true });
  const createAndRace = page.getByRole("button", { name: "Create & Race" });
  await expect(select).toBeVisible();
  await expect(createAndRace).toHaveCount(0);
  const startingVariant = await selectedCar.getAttribute("data-variant");

  await next.click();
  await expect(selectedCar).not.toHaveAttribute("data-variant", startingVariant!);
  await previous.click();
  await expect(selectedCar).toHaveAttribute("data-variant", startingVariant!);

  const variants = new Set<string | null>();
  for (let index = 0; index < 9; index++) {
    variants.add(await selectedCar.getAttribute("data-variant"));
    await next.click();
  }
  expect(variants.size).toBe(9);
  await expect(selectedCar).toHaveAttribute("data-variant", startingVariant!);

  await next.focus();
  await page.keyboard.press("ArrowRight");
  await expect(selectedCar).not.toHaveAttribute("data-variant", startingVariant!);
  await page.keyboard.press("ArrowLeft");
  await expect(selectedCar).toHaveAttribute("data-variant", startingVariant!);

  await selectCar(page, "police");
  await select.click();
  const selectTrack = page.getByRole("button", { name: "Select track", exact: true });
  await expect(selectTrack).toBeVisible();
  await expect(createAndRace).toHaveCount(0);
  const selectedTrack = page.locator(".track-card.active");
  const startingTrack = await selectedTrack.getAttribute("data-track");
  await page.locator('[data-track-carousel="next"]').click();
  await expect(selectedTrack).not.toHaveAttribute("data-track", startingTrack!);
  await page.locator('[data-track-carousel="previous"]').click();
  await expect(selectedTrack).toHaveAttribute("data-track", startingTrack!);
  await selectTrack.click();
  await expect(createAndRace).toBeVisible();
  await page.getByLabel("Driver", { exact: true }).fill("Carousel Driver");
  await page.getByPlaceholder("New room name").fill("Sunset Session");

  await page.getByRole("button", { name: "Change car", exact: true }).click();
  await expect(select).toBeVisible();
  await expect(selectedCar).toHaveAttribute("data-variant", "police");
  await selectCar(page, "taxi");
  await select.click();
  await selectTrack.click();
  await expect(page.getByLabel("Driver", { exact: true })).toHaveValue("Carousel Driver");
  await expect(page.getByPlaceholder("New room name")).toHaveValue("Sunset Session");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("racer-variant"))).toBe("taxi");
});

test.describe("touch controls", () => {
  test.use({ hasTouch: true });

  test("car selection and race setup remain usable on a phone with reduced motion", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const next = page.getByRole("button", { name: "Next car", exact: true });
    await expect(next).toBeInViewport();
    await next.click();
    const select = page.getByRole("button", { name: "Select car", exact: true });
    await expect(select).toBeInViewport();
    await select.click();
    const selectTrack = page.getByRole("button", { name: "Select track", exact: true });
    await expect(selectTrack).toBeInViewport();
    await selectTrack.click();
    await page.getByLabel("Driver", { exact: true }).fill("Phone Driver");
    await page.getByPlaceholder("New room name").fill("Phone Session");
    const createAndRace = page.getByRole("button", { name: "Create & Race" });
    await expect(createAndRace).toBeEnabled();
    await page.getByRole("button", { name: "Change car", exact: true }).click();
    await expect(select).toBeInViewport();
    await select.click();
    await selectTrack.click();
    await createAndRace.click();
    await expect(page.locator(".hud-map")).toBeInViewport();
    await expect(page.locator(".hud-speed")).toBeInViewport();
    await expect(page.locator(".joystick")).toBeInViewport();
    const dial = (await page.locator(".hud-speed").boundingBox())!;
    const joystick = (await page.locator(".joystick").boundingBox())!;
    expect(dial.y + dial.height).toBeLessThanOrEqual(joystick.y);
    await page.screenshot({ path: testInfo.outputPath("race-hud-phone.png") });
  });
});
