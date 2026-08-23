import { SUNSET_RIDGE } from "@racing/shared";
import { expect, test } from "../fixtures/game-seam";

test("drives a server-accepted Plausible Lap through every Checkpoint in order", async ({
  db,
  game,
  page,
}) => {
  const playerName = "lap-driver";
  // The session declares the taxi Variant in hello; the Garage picker (#125)
  // writes this same localStorage key.
  await page.addInitScript(() => localStorage.setItem("racer-variant", "taxi"));
  await game.createRace({ playerName, roomName: "valid-lap" });

  const result = await game.driveLap();

  expect(result.state.injectionFinished).toBe(true);
  expect(result.state.lapSubmitted).toBe(true);
  expect(result.state.serverLaps).toBe(1);
  expect(result.checkpoints).toEqual([
    ...SUNSET_RIDGE.checkpoints.map((_, index) => index),
    0,
  ]);

  const accepted = await db.query<{ name: string; variant: string | null }>(
    "SELECT name, variant FROM best_laps WHERE name = $1 AND track = $2 AND difficulty = $3",
    [playerName, "sunset-ridge", "medium"],
  );
  // The hello carried the taxi Variant; the persisted lap snapshots it.
  expect(accepted.rows).toEqual([{ name: playerName, variant: "taxi" }]);

  // #127: a Pacer armed from this recorded lap drives the recorded Variant.
  // Leave the Room, arm the freshly persisted lap from the Pacer picker, and
  // race again — the PacerOverlay seam must report the recorded taxi.
  const pacerVariant = () =>
    game
      .state()
      .then((s) => (s as { pacerVariant?: string | null }).pacerVariant);

  await page.getByRole("button", { name: "Leave race" }).click();
  await expect(page.getByLabel("Driver", { exact: true })).toBeVisible();
  const pacerSelect = page.locator(".pacer-select");
  // Value "0" is the single replay-bearing human entry: lap-driver's lap above.
  await pacerSelect.selectOption("0");
  await page.getByPlaceholder("New room name").fill("pacer-vs-taxi");
  await page.getByRole("button", { name: "Create & Race" }).click();
  await page.waitForFunction(() => window.__game !== undefined);
  await expect.poll(pacerVariant, { timeout: 10_000 }).toBe("taxi");

  // #127: the AI Record pacer always drives police — its canonical car, not a
  // recorded value.
  await page.getByRole("button", { name: "Leave race" }).click();
  await expect(page.getByLabel("Driver", { exact: true })).toBeVisible();
  await pacerSelect.selectOption("ai");
  await page.getByPlaceholder("New room name").fill("pacer-vs-ai");
  await page.getByRole("button", { name: "Create & Race" }).click();
  await page.waitForFunction(() => window.__game !== undefined);
  await expect.poll(pacerVariant, { timeout: 10_000 }).toBe("police");
});

test("real keyboard input crosses the first Checkpoint", async ({ game, page }) => {
  await game.createRace({ playerName: "key-driver", roomName: "keyboard-smoke" });

  await page.keyboard.down("KeyW");
  await expect.poll(() => game.state().then((state) => state.checkpoint)).toBe(1);
  await page.keyboard.up("KeyW");
});
