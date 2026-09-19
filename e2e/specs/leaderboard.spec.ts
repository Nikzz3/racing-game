import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/game-seam";

function leaderboardNames(page: Page): Promise<string[]> {
  return page.locator(".lb-list .lb-name").allTextContents();
}

test("a driven Plausible Lap persists between seeded rivals, segregated by Track and Difficulty, and survives reload", async ({
  db,
  game,
  page,
}) => {
  // Server truncates names to 16 chars (see server/src/index.ts), so stay within it.
  const playerName = "Persist Driver";
  await db.seedBestLap({ name: "Alpha", timeMs: 1_000 });
  await db.seedBestLap({ name: "Omega", timeMs: 9_999_999, withReplay: true });
  // Faster than everyone, but on another (Track, Difficulty) pair: never listed here.
  await db.seedBestLap({ name: "Other Pair", timeMs: 500, track: "stormhaven", difficulty: "hard" });

  await game.createRace({ playerName, roomName: "Persistence Room" });
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", "Omega"]);
  await game.driveLap();

  const persisted = await db.bestLapFor(playerName);
  expect(persisted.map((lap) => lap.name)).toEqual([playerName]);
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", playerName, "Omega"]);

  await page.reload();
  await expect.poll(() => leaderboardNames(page)).toEqual(["Alpha", playerName, "Omega"]);
});

// "A slower lap never overwrites a driver's better time" is a server/Postgres
// concern: server/src/best-lap-persistence.test.ts proves it against a real
// database in seconds, where a browser lap would cost the suite a minute.
