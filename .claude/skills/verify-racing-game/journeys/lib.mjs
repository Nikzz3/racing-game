// UI-path helpers shared by journeys. They drive the same controls a player uses;
// mirror e2e/fixtures/lobby.ts when the lobby changes.
import { expect } from "../scripts/harness.mjs";

/** Wait for the Lobby deck (garage → track → setup screens) and the loading overlay to clear. */
export async function openLobby(page) {
  await page.goto("/");
  await page.locator(".lobby-deck").waitFor();
  // On the real build the "Loading your garage" overlay swallows clicks until it is gone;
  // under software WebGL on a busy host that has taken over 30 s.
  await expect(page.locator(".game-loading:not(.is-ready)")).toHaveCount(0, { timeout: 120_000 });
}

/** Pick a car by clicking its Garage card. */
export async function selectCar(page, variant) {
  const card = page.locator(`.garage-card[data-variant="${variant}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-checked", "true");
}

/** Confirm the displayed car and track (whichever screens are still ahead), then open a Race Setup tab. */
export async function openSetupTab(page, tab /* "race" | "records" */) {
  const deck = page.locator(".lobby-deck");
  await deck.waitFor();
  if ((await deck.getAttribute("data-screen")) === "garage")
    await page.getByRole("button", { name: "Select car", exact: true }).click();
  if ((await deck.getAttribute("data-screen")) === "track")
    await page.getByRole("button", { name: "Select track", exact: true }).click();
  await page.locator(`[data-setup-tab="${tab}"]`).click();
}

/** Name the driver, name a new Room, Create & Race. `pacer` is the Pacer picker option value. */
export async function createRoom(page, { playerName, roomName, pacer }) {
  await openSetupTab(page, "race");
  await page.getByLabel("Driver", { exact: true }).fill(playerName);
  if (pacer !== undefined) await page.locator(".pacer-select").selectOption(pacer);
  await page.getByPlaceholder("New room name").fill(roomName);
  await page.getByRole("button", { name: "Create & Race" }).click();
}

/** Name the driver, pick the open Room from the list, Join & Race. */
export async function joinRoom(page, { playerName, roomName }) {
  await openSetupTab(page, "race");
  await page.getByLabel("Driver", { exact: true }).fill(playerName);
  await page.locator(".room-row").filter({ hasText: roomName }).click();
  await page.getByRole("button", { name: "Join & Race" }).click();
}

/** The in-Room HUD standings table, visible once a Room is joined. */
export const standings = (page) => page.locator(".hud-standings tbody");

/** Seam builds: replay CarInput[] in real time and wait until they are consumed. */
export async function driveInputs(page, inputs, timeout = 240_000) {
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate((injected) => window.__game.inject(injected), inputs);
  await page.waitForFunction(() => window.__game?.state().injectionFinished === true, undefined, {
    timeout,
  });
  return page.evaluate(() => window.__game?.trajectory() ?? []);
}

/** A run-unique suffix so journeys never collide on Room or driver names. */
export const uid = () => Math.random().toString(36).slice(2, 7);
