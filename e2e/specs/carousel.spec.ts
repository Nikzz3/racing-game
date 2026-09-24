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
    await fillStandings(page, 8);
    // Pin both warnings on so the screenshots show their slot; opacity doesn't move any box.
    await page
      .locator(".offtrack-warn, .cp-miss-warn")
      .evaluateAll((warnings) => warnings.forEach((w) => ((w as HTMLElement).style.opacity = "1")));
    // One race, resized between checks: portrait then landscape, each on a roomy and a short phone.
    for (const [width, height, name] of [
      [390, 844, "race-hud-portrait-390x844.png"],
      [375, 667, "race-hud-portrait-375x667.png"],
      [844, 390, "race-hud-landscape-844x390.png"],
      [667, 375, "race-hud-landscape-667x375.png"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectTouchHudFits(page);
      await page.screenshot({ path: testInfo.outputPath(name) });
    }
  });
});

/** Pad BEST LAPS out to a busy room's worth of rows by cloning the driver's own row. */
async function fillStandings(page: Page, rows: number): Promise<void> {
  const tbody = page.locator(".hud-standings tbody");
  await expect(tbody.locator("tr")).toHaveCount(1);
  await tbody.evaluate((element, count) => {
    const row = element.querySelector("tr")!;
    for (let index = 1; index < count; index++) {
      const clone = row.cloneNode(true) as HTMLTableRowElement;
      clone.classList.remove("me");
      clone.cells[0].textContent = String(index + 1);
      element.append(clone);
    }
  }, rows);
  await expect(tbody.locator("tr")).toHaveCount(rows);
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Fails when the boxes come within `gap` pixels of each other. */
function expectApart(a: Box, b: Box, what: string, gap = 0): void {
  const overlap =
    a.x - gap < b.x + b.width &&
    b.x < a.x + a.width + gap &&
    a.y - gap < b.y + b.height &&
    b.y < a.y + a.height + gap;
  expect(overlap, `${what} overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false);
}

/**
 * The steering slider sits in the left half, the pedals in the right half with GAS above
 * BRAKE, and no two of the controls and HUD panels overlap, a full BEST LAPS panel included.
 */
async function expectTouchHudFits(page: Page): Promise<void> {
  const { width } = page.viewportSize()!;
  const gas = await boxOf(page.getByRole("button", { name: "Accelerate", exact: true }));
  const brake = await boxOf(page.getByRole("button", { name: "Brake", exact: true }));
  const pedals = await boxOf(page.locator(".touch-pedals"));
  const steer = await boxOf(page.locator(".touch-steer"));
  const actions = await boxOf(page.locator(".hud-actions"));
  expect(gas.y + gas.height).toBeLessThanOrEqual(brake.y);
  expect(steer.x + steer.width).toBeLessThanOrEqual(width / 2);
  expect(pedals.x).toBeGreaterThanOrEqual(width / 2);
  // A thumb slipping off a driving control must not land on "Leave race".
  expectApart(actions, steer, "race actions and steering slider", 20);
  expectApart(actions, pedals, "race actions and pedals", 20);
  // Warnings keep their boxes while hidden, so they are checked even when not showing.
  const boxes: [string, Box][] = [
    ["pedals", pedals],
    ["steering slider", steer],
    ["race actions", actions],
    ["minimap", await boxOf(page.locator(".hud-map"))],
    ["speed dial", await boxOf(page.locator(".hud-speed"))],
    ["standings", await boxOf(page.locator(".hud-standings"))],
    ["off-track warning", await boxOf(page.locator(".offtrack-warn"))],
    ["checkpoint warning", await boxOf(page.locator(".cp-miss-warn"))],
    ["lap progress", await boxOf(page.locator(".hud-top-left"))],
    ["lap timer", await boxOf(page.locator(".hud-timer"))],
  ];
  for (const [index, [name, box]] of boxes.entries()) {
    for (const [otherName, other] of boxes.slice(index + 1)) {
      expectApart(box, other, `${name} and ${otherName}`);
    }
  }
}
