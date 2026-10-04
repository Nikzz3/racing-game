import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/game-seam";
import { createRoom, openRaceSettings } from "../fixtures/lobby";

/** What the fake pad records, and the controls a test moves on it. */
interface PadControls {
  /** Left stick, -1 (left) to 1 (right). */
  steer?: number;
  /** Right trigger, 0 to 1. */
  throttle?: number;
  /** Left trigger, 0 to 1. */
  brake?: number;
  /** Y / Triangle. */
  respawn?: boolean;
}

declare global {
  interface Window {
    __pad?: { set(controls: PadControls): void; rumbles: { type: string; strong: number }[] };
  }
}

/**
 * Stands in for a standard-mapping gamepad: no real pad exists in CI, and Chromium only
 * lists one after a physical button press. Its haptic actuator records every effect.
 */
function installFakePad(): void {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const axes = [0, 0, 0, 0];
  const rumbles: { type: string; strong: number }[] = [];
  const pad = {
    id: "Fake standard pad",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes,
    buttons,
    vibrationActuator: {
      playEffect(type: string, params: { strongMagnitude?: number } = {}) {
        rumbles.push({ type, strong: params.strongMagnitude ?? 0 });
        return Promise.resolve("complete");
      },
      reset: () => Promise.resolve("complete"),
    },
  };
  const press = (index: number, value: number) => {
    buttons[index] = { pressed: value > 0.5, touched: value > 0, value };
  };
  window.__pad = {
    set({ steer = 0, throttle = 0, brake = 0, respawn = false }) {
      axes[0] = steer;
      press(7, throttle);
      press(6, brake);
      press(3, respawn ? 1 : 0);
      pad.timestamp++;
    },
    rumbles,
  };
  Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
}

function setPad(page: Page, controls: PadControls): Promise<void> {
  return page.evaluate((next) => window.__pad!.set(next), controls);
}

// CI renders at a few frames per second, and the physics clock caps catch-up per frame,
// so simulated seconds pass several times slower than real ones.
const slow = { timeout: 60_000 };

test("drives with an analog gamepad, rumbles off the road and respawns from the pad", async ({
  page,
  game,
}) => {
  await page.addInitScript(installFakePad);
  await game.createRace({ playerName: "Pad Driver", roomName: "Pad Session" });
  const speed = async () => (await game.state()).speed;
  const heading = async () => (await game.state()).heading;
  const start = await game.state();

  // Half the right trigger drives the car straight ahead.
  await setPad(page, { throttle: 0.5 });
  await expect.poll(speed, slow).toBeGreaterThan(start.speed + 8);
  expect(await heading()).toBeCloseTo(start.heading, 6);

  // Full left stick with full throttle turns left (a growing heading), and the tight
  // circle soon leaves the road, where the pad rumbles.
  const beforeTurn = await game.state();
  await setPad(page, { throttle: 1, steer: -1 });
  await expect.poll(heading, slow).toBeGreaterThan(beforeTurn.heading + 0.4);
  await expect(page.locator(".offtrack-warn")).toHaveClass(/\bvisible\b/, slow);
  await expect
    .poll(() => page.evaluate(() => window.__pad!.rumbles.filter((r) => r.strong > 0).length))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__pad!.rumbles.map((r) => r.type))).toContain(
    "dual-rumble",
  );

  // Y respawns the car on the grid, standing still.
  await setPad(page, { respawn: true });
  await expect
    .poll(async () => {
      const { position } = await game.state();
      return Math.hypot(position.x - start.position.x, position.z - start.position.z);
    }, slow)
    .toBeLessThan(1);
  await setPad(page, {});
  expect(Math.abs(await speed())).toBeLessThan(1);
});

test("plays the race at the Lobby's volume and mutes from the HUD or the M key", async ({
  page,
  game,
}) => {
  await page.goto("/");
  await openRaceSettings(page);
  const volume = page.getByRole("slider", { name: "Volume" });
  const mute = page.getByRole("button", { name: "Mute", exact: true });
  await expect(volume).toBeVisible();
  await volume.fill("40");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await createRoom(page, { playerName: "Listener", roomName: "Sound Session" });
  await page.waitForFunction(() => window.__game !== undefined);
  const sound = async () => (await game.state()).sound;

  // The lobby clicks were the user gesture autoplay needs, so the engine runs from the
  // start; muted in the Lobby, it is silent.
  await expect.poll(sound).toMatchObject({ context: "running", engines: 1, gain: 0 });
  const hudMute = page.getByRole("button", { name: "Mute", exact: true });
  await expect(hudMute).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("m");
  await expect(hudMute).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await sound())?.gain).toBeGreaterThan(0);

  await hudMute.click();
  await expect(hudMute).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await sound())?.gain).toBe(0);

  // Both choices persist like the other Lobby choices.
  await page.reload();
  await openRaceSettings(page);
  await expect(volume).toHaveValue("40");
  await expect(mute).toHaveAttribute("aria-pressed", "true");
});
