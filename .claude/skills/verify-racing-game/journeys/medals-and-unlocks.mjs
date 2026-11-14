// features/medals-and-unlocks.md — a fresh driver sees the Medal targets and locked cars.
// Two `drive` bots under the same driver name earn Bronze (pace 0.8), then Silver (pace 1),
// and the real-build Lobby and HUD reflect each tier and its unlocks: after a reload and on
// a fresh device. A Medal is read off the name's persisted best, so whoever drove it counts.
import { journey } from "../scripts/harness.mjs";
import { createRoom, openLobby, openSetupTab, selectCar, standings, uid } from "./lib.mjs";

const id = uid();
const DRIVER = `Medal ${id}`; // the server keeps 16 chars
const ROOM = `Verify Medals ${id}`;

// Mirrors VARIANT_UNLOCKS and VARIANT_LABELS: the tier each locked car needs.
const LOCKED = [
  { variant: "sedan-sports", tier: "Bronze" },
  { variant: "race", tier: "Silver" },
  { variant: "police", tier: "Gold" },
  { variant: "race-future", tier: "Author" },
];
const TIERS = ["Bronze", "Silver", "Gold", "Author"];
const rank = (tier) => TIERS.indexOf(tier);

const card = (page, variant) => page.locator(`.garage-card[data-variant="${variant}"]`);
const selectCarButton = (page) => page.getByRole("button", { name: "Select car", exact: true });
const targets = (page) => page.getByRole("list", { name: "Medal targets" });
const target = (page, tier) => targets(page).getByRole("listitem").filter({ hasText: tier });
const chip = (page) => page.locator(".hud-medal");

/** Type the driver name the way a player does: the Lobby commits it (and fetches its Standings) on change. */
async function nameDriver(page, name) {
  const input = page.getByLabel("Driver", { exact: true });
  await input.fill(name);
  await input.press("Tab");
}

/** A `drive` bot under DRIVER in its own Room. `--stay` keeps it connected for the afterLap Standings. */
const medalBot = (j, botId, pace) =>
  j.bot(botId, [
    "--name",
    DRIVER,
    "--create",
    `${ROOM} ${botId}`,
    "--mode",
    "drive",
    "--pace",
    pace,
    "--stay",
    "5",
  ]);

await journey("medals-and-unlocks", async (j) => {
  const a = await j.player("a"); // real build: the driver's own device

  /** Race Setup (open) shows `tier` earned for DRIVER, the tiers up to it `earned`, the next one `Next`. */
  const expectSetupMedal = async (page, tier) => {
    await j.expect(page.locator(".medal-best")).toContainText(`${tier} medal`);
    await j.expect(page.locator(".medal-best")).not.toContainText("No lap yet");
    for (const t of TIERS) {
      if (rank(t) <= rank(tier)) await j.expect(target(page, t)).toContainText("earned");
      else await j.expect(target(page, t)).not.toContainText("earned");
    }
    await j.expect(target(page, TIERS[rank(tier) + 1])).toContainText("Next");
  };
  /** Garage (open) locks match `tier`: cars at or below it are unlocked, the rest locked. */
  const expectGarageLocks = async (page, tier) => {
    for (const c of LOCKED) {
      if (rank(c.tier) <= rank(tier))
        await j.expect(card(page, c.variant)).not.toHaveClass(/\blocked\b/);
      else await j.expect(card(page, c.variant)).toHaveClass(/\blocked\b/);
    }
  };
  /** A finished bot lap: lap + afterLap Standings with a best on Sunset Ridge Medium. */
  const botLap = async (bot, label) => {
    const lap = await bot.until("lap");
    const after = await bot.until("standings");
    j.json(`${label}-lap`, { lap, standings: after });
    j.expect(lap.isPersonalBest).toBe(true);
    const board = after.standings.find(
      (s) => s.track === "sunset-ridge" && s.difficulty === "medium",
    );
    j.expect(board?.bestMs).not.toBeNull();
    j.expect(await bot.done).toBe(0);
    return lap;
  };

  await j.step("fresh driver: the Garage shows the four Medal-locked cars", async () => {
    await openLobby(a);
    for (const { variant, tier } of LOCKED) {
      await j.expect(card(a, variant)).toHaveClass(/\blocked\b/);
      await j
        .expect(card(a, variant).locator(".garage-card-lock"))
        .toContainText(`Locked. Earn ${tier === "Author" ? "an" : "a"} ${tier} medal to unlock`);
    }
    await card(a, "sedan-sports").click();
    await j.expect(selectCarButton(a)).toBeDisabled();
    await j.expect(a.locator(".car-lock-note")).toHaveText("Earn a Bronze medal to unlock");
    await j.shot("a", "01-garage-coupe-locked");
  });

  await j.step(
    "Race Setup lists the Medal targets: Bronze is Next, Your best: No lap yet",
    async () => {
      await selectCar(a, "suv");
      await openSetupTab(a, "race");
      await nameDriver(a, DRIVER);
      await j
        .expect(targets(a).getByRole("listitem"))
        .toHaveText(TIERS.map((t) => new RegExp(`^${t}\\d:\\d\\d\\.\\d{3}`)));
      await j.expect(target(a, "Bronze")).toContainText("Next");
      for (const t of TIERS.slice(1)) await j.expect(target(a, t)).not.toContainText("Next");
      await j.expect(a.locator(".medal-best")).toContainText("Your best");
      await j.expect(a.locator(".medal-best")).toContainText("No lap yet");
      await j.shot("a", "02-setup-medal-targets");
      await j.aria("a", "02-setup-medal-panel", ".medal-panel");
    },
  );

  // The Lobby fetched DRIVER's (empty) Standings on the name change above and only fetches
  // again on a reload or another name change, so the bot can start now without racing the
  // "no Medal yet" assertions below.
  const bronze = medalBot(j, "bronze", "0.8");

  await j.step("in a Room the HUD chip reads NEXT · BRONZE", async () => {
    await createRoom(a, { playerName: DRIVER, roomName: ROOM });
    await j.expect(standings(a)).toContainText(DRIVER);
    await j.expect(chip(a)).toBeVisible();
    await j.expect(chip(a)).toContainText("NEXT · BRONZE");
    await j.expect(chip(a)).toHaveAttribute("data-medal", "none");
    await j.shot("a", "03-hud-next-bronze");
  });

  let bronzeLap;
  await j.step(
    "a drive bot under the same name laps at pace 0.8 (Plausible, persisted)",
    async () => {
      bronzeLap = await botLap(bronze, "bot-bronze");
    },
  );

  // Same reasoning: A's reload fetches Standings within a second or two, long before this
  // ~30 s lap persists, so the Bronze assertions stay deterministic.
  const silver = medalBot(j, "silver", "1");

  await j.step(
    "reloaded: Bronze earned, Silver Next; the Coupe S unlocked, the Race still locked",
    async () => {
      await openLobby(a); // a fresh page load: the Lobby fetches the name's Standings on welcome
      await expectGarageLocks(a, "Bronze");
      await card(a, "sedan-sports").click();
      await j.expect(selectCarButton(a)).toBeEnabled();
      await j.expect(a.locator(".car-lock-note")).toBeHidden();
      await j.shot("a", "04-bronze-garage-coupe-unlocked");
      await openSetupTab(a, "race");
      await j.expect(a.getByLabel("Driver", { exact: true })).toHaveValue(DRIVER);
      await expectSetupMedal(a, "Bronze");
      await j.shot("a", "05-bronze-setup");
      await j.aria("a", "05-bronze-setup-medal-panel", ".medal-panel");
    },
  );

  await j.step("in a Room the HUD chip shows the Bronze badge and NEXT · SILVER", async () => {
    await createRoom(a, { playerName: DRIVER, roomName: `${ROOM} 2` });
    await j.expect(standings(a)).toContainText(DRIVER);
    await j.expect(chip(a)).toHaveAttribute("data-medal", "bronze");
    await j.expect(chip(a)).toHaveAttribute("data-next", "silver");
    await j.expect(chip(a)).toContainText("NEXT · SILVER");
    await j.shot("a", "06-hud-bronze-next-silver");
  });

  await j.step("a second drive bot at full pace beats it (personal best)", async () => {
    const silverLap = await botLap(silver, "bot-silver");
    // Compare, never assert values: the full-pace lap is the faster one.
    j.expect(silverLap.lapTimeMs).toBeLessThan(bronzeLap.lapTimeMs);
  });

  await j.step(
    "fresh device, same driver name: Silver earned, Gold Next; Coupe S and Race unlocked",
    async () => {
      const c = await j.player("c");
      await openLobby(c);
      await j.expect(card(c, "sedan-sports")).toHaveClass(/\blocked\b/); // a generated Racer name has no Medal
      await openSetupTab(c, "race");
      await nameDriver(c, DRIVER);
      await expectSetupMedal(c, "Silver");
      await j.shot("c", "07-fresh-device-silver-setup");
      await j.aria("c", "07-fresh-device-silver-medal-panel", ".medal-panel");
      await c.getByRole("button", { name: "Change car", exact: true }).click();
      await expectGarageLocks(c, "Silver");
      await card(c, "race").click();
      await j.expect(selectCarButton(c)).toBeEnabled();
      await card(c, "police").click();
      await j.expect(selectCarButton(c)).toBeDisabled();
      await j.expect(c.locator(".car-lock-note")).toHaveText("Earn a Gold medal to unlock");
      await j.shot("c", "08-fresh-device-silver-garage-police-locked");
    },
  );

  await j.step("one best_laps row (with its Replay) holds the name's best", async () => {
    const rows = await j.sql(
      "SELECT b.name, b.track, b.difficulty, (r.name IS NOT NULL) AS has_replay FROM best_laps b LEFT JOIN replays r USING (name, track, difficulty) WHERE b.name = $1",
      [DRIVER],
    );
    j.json("db-best-laps", rows);
    j.expect(rows).toEqual([
      { name: DRIVER, track: "sunset-ridge", difficulty: "medium", has_replay: true },
    ]);
  });
});
