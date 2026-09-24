import type { Locator, Page } from "@playwright/test";
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

  test("car selection and race setup remain usable on a phone with reduced motion", async ({
    page,
  }, testInfo) => {
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
    await expectTouchHudFits(page);
    await page.screenshot({ path: testInfo.outputPath("race-hud-phone.png") });

    await page.setViewportSize({ width: 844, height: 390 });
    await expectTouchHudFits(page);
    await page.screenshot({ path: testInfo.outputPath("race-hud-phone-landscape.png") });
  });
});

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function expectApart(a: Box, b: Box, what: string): void {
  const overlap =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, `${what} overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false);
}

/** The pedals sit on the left, the steering slider on the right, and neither covers the HUD. */
async function expectTouchHudFits(page: Page): Promise<void> {
  const { width } = page.viewportSize()!;
  const gas = await boxOf(page.getByRole("button", { name: "Accelerate", exact: true }));
  const brake = await boxOf(page.getByRole("button", { name: "Brake", exact: true }));
  const pedals = await boxOf(page.locator(".touch-pedals"));
  const steer = await boxOf(page.locator(".touch-steer"));
  const map = await boxOf(page.locator(".hud-map"));
  const actions = await boxOf(page.locator(".hud-actions"));
  const speed = await boxOf(page.locator(".hud-speed"));
  expect(gas.y + gas.height).toBeLessThanOrEqual(brake.y);
  expect(pedals.x + pedals.width).toBeLessThanOrEqual(width / 2);
  expect(steer.x).toBeGreaterThanOrEqual(width / 2);
  expectApart(pedals, map, "pedals and minimap");
  expectApart(pedals, actions, "pedals and race actions");
  expectApart(map, actions, "minimap and race actions");
  expectApart(steer, speed, "steering slider and speed dial");
  // Warnings are laid out while hidden, so their boxes are checked before they ever show.
  const offTrack = await boxOf(page.locator(".offtrack-warn"));
  const checkpointMissed = await boxOf(page.locator(".cp-miss-warn"));
  expectApart(offTrack, checkpointMissed, "the two warnings");
  for (const [warning, name] of [
    [offTrack, "off-track warning"],
    [checkpointMissed, "checkpoint warning"],
  ] as const) {
    for (const [control, controlName] of [
      [pedals, "pedals"],
      [steer, "steering slider"],
      [map, "minimap"],
      [actions, "race actions"],
      [speed, "speed dial"],
    ] as const) {
      expectApart(warning, control, `${name} and ${controlName}`);
    }
  }
}
