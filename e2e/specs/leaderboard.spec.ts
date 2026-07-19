import { expect, test } from "../fixtures/game-seam";

const leaderboardNames = (page: import("@playwright/test").Page) =>
  page.locator(".lb-list .lb-name").allTextContents();

test("a driven Plausible Lap persists between seeded rivals and survives reload", async ({
  db,
  game,
  page,
}) => {
  const playerName = "Persistence Driver";
  await db.seedBestLap({ name: "Alpha", timeMs: 1_000 });
  await db.seedBestLap({ name: "Omega", timeMs: 9_999_999, withReplay: true });

  await game.createRace({ playerName, roomName: "Persistence Room" });
  await game.driveLap();

  const persisted = await db.query<{ name: string }>(
    "SELECT name FROM best_laps WHERE name = $1 AND track = $2 AND difficulty = $3",
    [playerName, "sunset-ridge", "medium"],
  );
  expect(persisted.rows).toEqual([{ name: playerName }]);
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", playerName, "Omega"]);

  await page.reload();
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", playerName, "Omega"]);
});

test("keeps leaderboard entries segregated by Track and Difficulty", async ({ db, game, page }) => {
  await db.seedBestLap({ name: "Current Pair", timeMs: 2_000 });
  await db.seedBestLap({
    name: "Other Pair",
    timeMs: 1_000,
    track: "stormhaven",
    difficulty: "hard",
  });

  await game.createRace({ playerName: "Pair Driver", roomName: "Pair Room" });

  await expect.poll(() => leaderboardNames(page)).toEqual(["Current Pair"]);
});

test("a slower driven lap does not overwrite the driver's better time", async ({ db, game }) => {
  const playerName = "Already Faster";
  await db.seedBestLap({ name: playerName, timeMs: 1_000 });
  await game.createRace({ playerName, roomName: "Personal Best Room" });

  // If the suite's lap budget becomes costly, this conditional-upsert case can
  // move to a server/DB integration test; for now it deliberately stays end-to-end.
  await game.driveLap();

  const persisted = await db.query<{ time_ms: number }>(
    "SELECT time_ms FROM best_laps WHERE name = $1 AND track = $2 AND difficulty = $3",
    [playerName, "sunset-ridge", "medium"],
  );
  expect(persisted.rows).toEqual([{ time_ms: 1_000 }]);
});
