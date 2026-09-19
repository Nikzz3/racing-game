import { expect, test } from "../fixtures/game-seam";

test("arms the AI Record and sees it pacing in a Room", async ({ game, page }) => {
  await game.createRace({
    playerName: "AI Racer",
    roomName: "AI Pacer Room",
    pacer: "ai",
  });

  // The in-Room Pacer chip names the armed Pacer.
  const chip = page.locator(".pacer-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("AI Record");

  // #127: the AI Record always drives police, its canonical car, not a recorded value.
  await expect.poll(() => game.state().then((s) => s.pacerVariant), { timeout: 10_000 }).toBe("police");

  // The AI's frames are baked client-side and handed straight to the Game;
  // the overlay car stays hidden until the first start-line crossing.
  await expect.poll(() => game.state().then((s) => s.pacer?.frameCount)).toBeGreaterThan(0);
  expect((await game.state()).pacer).toMatchObject({ playing: false, visible: false });

  // Drive across the start line with a real key press.
  await page.keyboard.down("KeyW");
  // Software WebGL needs about six wall-clock seconds to simulate the launch, and
  // longer when workers contend for CPU: the frame loop caps each step at 50ms,
  // so below 20fps simulated time runs slower than the wall clock.
  await expect.poll(() => game.state().then((s) => s.checkpoint), { timeout: 40_000 }).toBe(1);
  await page.keyboard.up("KeyW");

  // After the first start-line crossing a translucent Pacer car is in the scene.
  await expect.poll(() => game.state().then((s) => s.pacer)).toMatchObject({
    playing: true,
    visible: true,
  });
  const pacer = (await game.state()).pacer!;
  expect(pacer.opacity).toBeGreaterThan(0);
  expect(pacer.opacity).toBeLessThan(1);
});
