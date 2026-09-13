import type { Page } from "@playwright/test";
import { CAR_VARIANTS, type Variant } from "@racing/shared";

/** Select a model using the same arrow control available to players. */
export async function selectCar(page: Page, variant: Variant | "random"): Promise<void> {
  const current = page.locator(".garage-card.active");
  const next = page.getByRole("button", { name: "Next car", exact: true });
  await next.waitFor();
  for (let step = 0; step <= CAR_VARIANTS.length; step++) {
    if ((await current.getAttribute("data-variant")) === variant) return;
    await next.click();
  }
  throw new Error(`Could not select car ${variant}`);
}

/** Confirm the displayed car before opening the race setup screen. */
export async function openRaceSettings(page: Page): Promise<void> {
  const deck = page.locator(".lobby-deck");
  await deck.waitFor();
  if ((await deck.getAttribute("data-screen")) === "garage")
    await page.getByRole("button", { name: "Select car", exact: true }).click();
  if ((await deck.getAttribute("data-screen")) === "track")
    await page.getByRole("button", { name: "Select track", exact: true }).click();
  await page.locator('[data-setup-tab="race"]').click();
}

export interface CreateRoomOptions {
  playerName: string;
  roomName: string;
  /**
   * Option value to arm in the Starting Grid Pacer picker before creating the
   * Room: "ai" for the AI Record, or a human row's numeric index value.
   */
  pacer?: string;
}

/**
 * Drives the lobby form on an already-loaded page: name the driver, name the Room, race.
 * Callers own the navigation so they can attach listeners before the page loads.
 */
export async function createRoom(
  page: Page,
  { playerName, roomName, pacer }: CreateRoomOptions,
): Promise<void> {
  await openRaceSettings(page);
  await page.getByLabel("Driver").fill(playerName);
  if (pacer !== undefined) await page.locator(".pacer-select").selectOption(pacer);
  await page.getByPlaceholder("New room name").fill(roomName);
  await page.getByRole("button", { name: "Create & Race" }).click();
}
