import { expect, test } from "../fixtures/game-seam";

// Red bookend for #110: the Game does not surface Pacer overlay state through
// the seam yet (pacerState is a null stub), so the frameCount poll times out.
test.fail();

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

  // The AI's frames are baked client-side and handed straight to the Game;
  // the overlay car stays hidden until the first start-line crossing.
  await expect.poll(() => game.state().then((s) => s.pacer?.frameCount)).toBeGreaterThan(0);
  expect((await game.state()).pacer).toMatchObject({ playing: false, visible: false });

  // Drive across the start line with a real key press.
  await page.keyboard.down("KeyW");
  await expect.poll(() => game.state().then((s) => s.checkpoint)).toBe(1);
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
