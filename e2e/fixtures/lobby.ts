import type { Page } from "@playwright/test";

export interface CreateRoomOptions {
  playerName: string;
  roomName: string;
}

/**
 * Drives the lobby form on an already-loaded page: name the driver, name the Room, race.
 * Callers own the navigation so they can attach listeners before the page loads.
 */
export async function createRoom(
  page: Page,
  { playerName, roomName }: CreateRoomOptions,
): Promise<void> {
  await page.getByLabel("Driver").fill(playerName);
  await page.getByPlaceholder("New room name").fill(roomName);
  await page.getByRole("button", { name: "Create & Race" }).click();
}
