import type { Page } from "@playwright/test";
import { SUNSET_RIDGE } from "@racing/shared";
import type { E2eLocalState } from "../../client/src/game/e2e-seam";
import { expect, test } from "../fixtures/game-seam";
import { createRoom } from "../fixtures/lobby";
import lapInputs from "../lap-inputs.json" with { type: "json" };

/**
 * A prefix of the recorded lap: long enough to cover launch and a corner, short
 * enough that replaying it twice at real-time pace stays inside the e2e budget.
 */
const DETERMINISM_INPUTS = lapInputs.slice(0, 240);

/** The physics half of a sample; the rest of the state is fed by server snapshots. */
function motion(trajectory: E2eLocalState[]) {
  return trajectory.map(({ position, heading, speed }) => ({ position, heading, speed }));
}

/** Driver names in the lobby's Records panel, in rank order. */
function leaderboardNames(page: Page): Promise<string[]> {
  return page.locator(".lb-list .lb-name").allTextContents();
}

// One real-time lap carries every assertion that needs a server-accepted lap:
// checkpoint order, the persisted Variant, leaderboard rank among seeded rivals
// (segregated by Track and Difficulty), the Pacer picker, and reload persistence.
// A second lap-driving spec would cost the suite another 40s of wall time.
test("drives a server-accepted Plausible Lap through every Checkpoint in order", async ({
  db,
  game,
  page,
}) => {
  // Server truncates names to 16 chars (see server/src/index.ts), so stay within it.
  const playerName = "lap-driver";
  // Rivals bracket the driven lap: Alpha is faster, Omega slower. Other Pair is
  // faster than everyone but on another (Track, Difficulty) pair: never listed here.
  await db.seedBestLap({ name: "Alpha", timeMs: 1_000 });
  await db.seedBestLap({ name: "Omega", timeMs: 9_999_999 });
  await db.seedBestLap({ name: "Other Pair", timeMs: 500, track: "stormhaven", difficulty: "hard" });
  // The session declares the taxi Variant in hello; the Garage picker (#125)
  // writes this same localStorage key.
  await page.addInitScript(() => localStorage.setItem("racer-variant", "taxi"));
  await game.createRace({ playerName, roomName: "valid-lap" });
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", "Omega"]);

  const result = await game.driveLap();

  expect(result.state.injectionFinished).toBe(true);
  expect(result.state.lapSubmitted).toBe(true);
  expect(result.state.serverLaps).toBe(1);
  expect(result.checkpoints).toEqual([...SUNSET_RIDGE.checkpoints.map((_, index) => index), 0]);

  const accepted = await db.query<{ name: string; variant: string | null }>(
    "SELECT name, variant FROM best_laps WHERE name = $1 AND track = $2 AND difficulty = $3",
    [playerName, "sunset-ridge", "medium"],
  );
  // The hello carried the taxi Variant; the persisted lap snapshots it.
  expect(accepted.rows).toEqual([{ name: playerName, variant: "taxi" }]);
  expect((await db.bestLapFor(playerName)).map((lap) => lap.name)).toEqual([playerName]);
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", playerName, "Omega"]);

  // #127: a Pacer drives the Variant recorded with its lap. Leave the Room, arm a
  // Pacer from the picker, race again, and read the PacerOverlay seam.
  const pacerVariant = () => game.state().then((s) => s.pacerVariant);
  const raceAgainst = async (pacer: string, roomName: string) => {
    await page.getByRole("button", { name: "Leave race" }).click();
    await createRoom(page, { playerName, roomName, pacer });
    await page.waitForFunction(() => window.__game !== undefined);
  };

  // Value "0" is the single replay-bearing human entry: lap-driver's lap above.
  // (The AI Record's canonical Variant needs no driven lap; pacer.spec.ts covers it.)
  await raceAgainst("0", "pacer-vs-taxi");
  await expect.poll(pacerVariant, { timeout: 10_000 }).toBe("taxi");

  // The rank came from Postgres, not from client state: it survives a reload.
  await page.reload();
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", playerName, "Omega"]);
});

// "A slower lap never overwrites a driver's better time" is a server/Postgres
// concern: server/src/best-lap-persistence.test.ts proves it against a real
// database in seconds, where a browser lap would cost the suite 40 seconds.

test("replays the same inputs to an exactly equal trajectory in the browser", async ({ game }) => {
  // Same CarInput[], two fresh races in the same Chromium: the car's motion must
  // match bit for bit, or a recorded lap means nothing when it is replayed.
  await game.createRace({ playerName: "determinism-driver", roomName: "determinism-a" });
  const first = await game.driveInputs(DETERMINISM_INPUTS);

  await game.createRace({ playerName: "determinism-driver", roomName: "determinism-b" });
  const second = await game.driveInputs(DETERMINISM_INPUTS);

  expect(first).toHaveLength(DETERMINISM_INPUTS.length);
  expect(motion(second)).toEqual(motion(first));
});

test("real keyboard input crosses the first Checkpoint", async ({ game, page }, testInfo) => {
  await game.createRace({ playerName: "key-driver", roomName: "keyboard-smoke" });

  await page.keyboard.down("KeyW");
  // Software WebGL needs about six wall-clock seconds to simulate the launch, and
  // longer when workers contend for CPU: the frame loop caps each step at 50ms,
  // so below 20fps simulated time runs slower than the wall clock.
  await expect.poll(() => game.state().then((state) => state.checkpoint), { timeout: 40_000 }).toBe(1);
  await page.keyboard.up("KeyW");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".hud-map")).toBeInViewport();
  await expect(page.locator(".hud-speed")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("race-hud-desktop.png") });
});
