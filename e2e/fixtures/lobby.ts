import { expect, type Page } from "@playwright/test";
import type { Variant } from "@racing/shared";

/** Select a car by clicking its garage card, the same control available to players. */
export async function selectCar(page: Page, variant: Variant | "random"): Promise<void> {
  const card = page.locator(`.garage-card[data-variant="${variant}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-checked", "true");
}

/** Confirm the displayed car and track (whichever screens are still ahead), then open a Race Setup tab. */
export async function openSetupTab(page: Page, tab: "race" | "records"): Promise<void> {
  const deck = page.locator(".lobby-deck");
  await deck.waitFor();
  if ((await deck.getAttribute("data-screen")) === "garage")
    await page.getByRole("button", { name: "Select car", exact: true }).click();
  if ((await deck.getAttribute("data-screen")) === "track")
    await page.getByRole("button", { name: "Select track", exact: true }).click();
  await page.locator(`[data-setup-tab="${tab}"]`).click();
}

/** Confirm the displayed car and track, then open the race tab. */
export function openRaceSettings(page: Page): Promise<void> {
  return openSetupTab(page, "race");
}

export interface CreateRoomOptions {
  playerName: string;
  roomName: string;
  /** Pacer picker option to arm before creating the Room: "ai" for the AI Record, or a human row's index. */
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
  await page.getByLabel("Driver", { exact: true }).fill(playerName);
  if (pacer !== undefined) await page.locator(".pacer-select").selectOption(pacer);
  await page.getByPlaceholder("New room name").fill(roomName);
  await page.getByRole("button", { name: "Create & Race" }).click();
}
