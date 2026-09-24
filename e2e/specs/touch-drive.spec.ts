import type { CDPSession, Locator } from "@playwright/test";
import { expect, test } from "../fixtures/game-seam";

test.use({ hasTouch: true });

interface Finger {
  id: number;
  x: number;
  y: number;
}

/**
 * Real browser touch input through CDP. Playwright's page.touchscreen only taps with one
 * finger, while driving needs a pedal and the slider held at once. Every event lists all
 * fingers still down; touchEnd lifts them all.
 */
async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  fingers: Finger[],
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: fingers.map(({ id, x, y }) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** How far the knob sits from the slider's centre, in CSS pixels (negative is left). */
async function knobOffset(steer: Locator, knob: Locator): Promise<number> {
  const [track, thumb] = await Promise.all([steer.boundingBox(), knob.boundingBox()]);
  return thumb!.x + thumb!.width / 2 - (track!.x + track!.width / 2);
}

test("drives with a pedal and the steering slider held at once", async ({ page, game }) => {
  // A landscape phone; kept small because software WebGL cost scales with pixels.
  await page.setViewportSize({ width: 568, height: 320 });
  await game.createRace({ playerName: "Thumb Driver", roomName: "Touch Session" });

  const gas = page.getByRole("button", { name: "Accelerate", exact: true });
  const brake = page.getByRole("button", { name: "Brake", exact: true });
  const steer = page.locator(".touch-steer");
  const knob = page.locator(".touch-steer-knob");
  const cdp = await page.context().newCDPSession(page);
  const speed = async () => (await game.state()).speed;
  const heading = async () => (await game.state()).heading;
  // CI renders at a few frames per second, and the physics clock caps catch-up per frame,
  // so simulated seconds pass several times slower than real ones.
  const slow = { timeout: 60_000 };

  // Finger A holds GAS: the car accelerates in a straight line.
  const gasFinger: Finger = { id: 1, ...(await centreOf(gas)) };
  const start = await game.state();
  await touch(cdp, "touchStart", [gasFinger]);
  await expect(gas).toHaveClass(/\bpressed\b/);
  await expect.poll(speed, slow).toBeGreaterThan(start.speed + 8);
  expect(await heading()).toBeCloseTo(start.heading, 6);

  // Finger B lands on the slider's left end while A keeps GAS down. Full left steer is
  // CarInput.steer +1, which physics turns into a growing heading while moving forward.
  const steerBox = (await steer.boundingBox())!;
  const steerFinger: Finger = {
    id: 2,
    x: steerBox.x + 4,
    y: steerBox.y + steerBox.height / 2,
  };
  const beforeTurn = await game.state();
  await touch(cdp, "touchStart", [gasFinger, steerFinger]);
  await expect(gas).toHaveClass(/\bpressed\b/);
  await expect.poll(() => knobOffset(steer, knob)).toBeLessThan(-steerBox.width / 4);
  await expect.poll(heading, slow).toBeGreaterThan(beforeTurn.heading + 0.4);
  expect(await speed()).toBeGreaterThan(0);

  // Lifting both fingers releases the pedal and recentres the knob; the car then coasts
  // straight, losing speed without turning.
  await touch(cdp, "touchEnd", []);
  await expect(gas).not.toHaveClass(/\bpressed\b/);
  await expect.poll(async () => Math.abs(await knobOffset(steer, knob))).toBeLessThan(1);
  const released = await game.state();
  await expect.poll(speed, slow).toBeLessThan(released.speed - 2);
  expect(await heading()).toBeCloseTo(released.heading, 6);

  // BRAKE held past a standstill reverses, which coasting alone never does.
  await touch(cdp, "touchStart", [{ id: 3, ...(await centreOf(brake)) }]);
  await expect(brake).toHaveClass(/\bpressed\b/);
  await expect.poll(speed, slow).toBeLessThan(-1);
  await touch(cdp, "touchEnd", []);
  await expect(brake).not.toHaveClass(/\bpressed\b/);
});
