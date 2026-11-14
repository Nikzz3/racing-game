// features/daily-challenge.md — the Daily banner, Race the Daily into the shared Daily Room, a
// drive bot's Plausible Lap on today's Track landing on the Daily Board and the all-time board,
// and Share for the driver who set it.
import { journey } from "../scripts/harness.mjs";
import { openLobby, openSetupTab, standings, uid } from "./lib.mjs";

const id = uid();
const A = `Dawn ${id}`;
const B = `Dusk ${id}`;
// Banner labels for a Daily's Scene Preset (CONTEXT.md "Scene Preset").
const SCENE_LABELS = {
  sunset: "Sunset",
  "golden-hour": "Golden hour",
  dusk: "Dusk",
  "foggy-morning": "Foggy morning",
};

await journey("daily-challenge", async (j) => {
  // Clipboard access lets the journey read back what Share copied.
  const a = await j.player("a", {
    contextOptions: { permissions: ["clipboard-read", "clipboard-write"] },
  });
  const banner = a.getByRole("region", { name: "Daily Challenge" });
  const spec = (term) => banner.locator(".daily-specs div").filter({ hasText: term }).locator("dd");
  const result = banner.locator(".daily-result");
  const fastest = banner.getByRole("list", { name: "Today's fastest" });

  /** Name the driver in Race Setup, then go back to the Garage where the Daily banner lives. */
  async function nameDriver(name) {
    await openSetupTab(a, "race");
    await a.getByLabel("Driver", { exact: true }).fill(name);
    await a.getByRole("button", { name: "Change car" }).filter({ visible: true }).click();
    await j.expect(a.locator(".lobby-deck")).toHaveAttribute("data-screen", "garage");
    await j.expect(banner.locator(".daily-driver")).toHaveText(name);
  }

  // Today's Daily as the banner shows it.
  const daily = {};
  await j.step(
    "the Garage shows the Daily banner: number, Track, Difficulty, Car, Scene, no time yet",
    async () => {
      await openLobby(a);
      await j.expect(banner).toBeVisible();
      daily.numberText = (await banner.locator(".daily-number").textContent()).trim();
      j.expect(daily.numberText).toMatch(/^DAILY #\d+$/);
      daily.number = Number(daily.numberText.slice("DAILY #".length));
      daily.track = (await banner.locator(".daily-track").textContent()).trim();
      daily.difficulty = (await spec("Difficulty").textContent()).trim();
      daily.car = (await spec("Car").textContent()).trim();
      daily.scene = (await spec("Scene").textContent()).trim();
      for (const value of Object.values(daily)) j.expect(String(value)).not.toBe("");
      await j.expect(result).toHaveText("No time yet today");
      // Share stays disabled until the driver has a time today.
      await j.expect(banner.getByRole("button", { name: "Share" })).toBeDisabled();
      j.json("banner-today", daily);
      j.note(
        `today: ${daily.numberText} — ${daily.track}, ${daily.difficulty}, ${daily.car}, ${daily.scene}`,
      );
      await j.shot("a", "01-daily-banner");
      await j.aria("a", "01-daily-banner", ".daily");
    },
  );

  await j.step("the banner matches the Daily the server announced (welcome)", () => {
    const welcome = j.received("a", "welcome").at(-1);
    const challenge = welcome?.daily?.challenge;
    j.json("welcome-daily", welcome?.daily);
    j.expect(challenge?.number).toBe(daily.number);
    j.expect(SCENE_LABELS[challenge.scene]).toBe(daily.scene);
    daily.date = challenge.date;
  });

  await j.step("A names the driver; the banner shows A with no time yet", async () => {
    await nameDriver(A);
    await j.expect(result).toHaveText("No time yet today");
  });

  let joinedA;
  await j.step("A clicks Race the Daily and lands in the Daily Room", async () => {
    await a.getByRole("button", { name: "Race the Daily" }).click();
    await j.expect(a.locator(".hud-room")).toHaveText(`Daily #${daily.number}`);
    await j.expect(standings(a)).toContainText(A);
    joinedA = j.received("a", "joined").at(-1);
    j.json("a-joined", joinedA);
    j.expect(joinedA.roomName).toBe(`Daily #${daily.number}`);
    j.expect(joinedA.daily?.number).toBe(daily.number);
    j.expect(SCENE_LABELS[joinedA.daily.scene]).toBe(daily.scene);
    await j.shot("a", "02-a-in-daily-room");
  });

  // Driver B is a headless drive bot: Race the Daily over the real protocol, then one Plausible Lap.
  const bot = j.bot("b", ["--name", B, "--daily", "--mode", "drive"]);
  await j.step(
    "driver B (bot) races the Daily and lands in the SAME Daily Room; A sees B",
    async () => {
      const joinedB = await bot.until("joined");
      j.expect(joinedB.roomId).toBe(joinedA.roomId);
      j.expect(joinedB.daily).toBe(daily.number);
      j.expect([joinedB.track, joinedB.difficulty]).toEqual([joinedA.track, joinedA.difficulty]);
      await j.expect(standings(a)).toContainText(B);
      await j.shot("a", "03-a-sees-b-in-daily-room");
    },
  );

  await j.step("the Daily Room is not a persisted Room", async () => {
    const rows = await j.sql("SELECT id FROM rooms WHERE id = $1", [joinedA.roomId]);
    j.expect(rows).toHaveLength(0);
  });

  await j.step(
    "B drives a Plausible Lap of today's Track; the server posts it to the Daily Board",
    async () => {
      await bot.until("lap");
      j.expect(await bot.done).toBe(0);
      await j.expect
        .poll(() => j.received("a", "daily").some((m) => m.board.entries.some((e) => e.name === B)))
        .toBe(true);
      const laps = j.received("a", "lap").filter((m) => m.name === B);
      j.json("a-sees-b-lap", laps);
      j.expect(laps.length).toBeGreaterThanOrEqual(1);
      j.json("daily-messages", j.received("a", "daily"));
      await j.shot("a", "04-a-sees-b-lap");
    },
  );

  await j.step(
    "daily_laps holds B's lap for today; best_laps holds it on the all-time board",
    async () => {
      const dailyRows = await j.sql(
        "SELECT day::text AS day, name, time_ms FROM daily_laps WHERE name = $1",
        [B],
      );
      j.json("db-daily-laps", dailyRows);
      j.expect(dailyRows).toHaveLength(1);
      j.expect(dailyRows[0].day).toBe(daily.date);
      const allTime = await j.sql(
        "SELECT name, track, difficulty, variant FROM best_laps WHERE name = $1",
        [B],
      );
      j.json("db-best-laps", allTime);
      // The Daily forces its Variant on every driver in the Daily Room, the bot included.
      j.expect(allTime).toEqual([
        {
          name: B,
          track: joinedA.track,
          difficulty: joinedA.difficulty,
          variant: joinedA.daily.variant,
        },
      ]);
    },
  );

  await j.step(
    "A leaves: the banner lists B among today's fastest, A still has no time",
    async () => {
      await a.getByRole("button", { name: "Leave race" }).click();
      await a.locator(".lobby-deck").waitFor();
      await j.expect(fastest).toContainText(B);
      await j.expect(result).toHaveText("No time yet today");
      await j.shot("a", "05-a-banner-board");
      await j.aria("a", "05-a-banner-board", ".daily");
    },
  );

  await j.step(
    "A's Records tab lists B's lap on the all-time board for that Track and Difficulty",
    async () => {
      await openSetupTab(a, "records");
      await a.locator(`[data-board-diff="${joinedA.difficulty}"]`).click();
      await a.locator("[data-board-track-toggle]").click();
      await a.locator(`[data-board-track="${joinedA.track}"]`).click();
      await j.expect(a.locator(".lb-list")).toContainText(B);
      await j.expect(a.getByRole("button", { name: `Watch ${B} replay` })).toBeVisible();
      await j.shot("a", "06-records-all-time");
    },
  );

  // The banner finds a driver's standing by name, as on any device the driver plays from.
  await j.step(
    "driver B in the browser: the banner shows B's place and time today, Share enabled",
    async () => {
      await nameDriver(B);
      await j.expect(result).toHaveText(/^P\d+ of \d+ · \d+:\d\d\.\d{3}$/);
      await j.expect(banner.getByRole("button", { name: "Share" })).toBeEnabled();
      await j.shot("a", "07-b-banner-with-time");
    },
  );

  await j.step(
    "B clicks Share: the button confirms and the clipboard holds the Daily line",
    async () => {
      await banner.getByRole("button", { name: "Share" }).click();
      await j.expect(banner.locator(".daily-share")).toHaveText("Copied ✓");
      await j.shot("a", "08-share-copied");
      const copied = await a.evaluate(() => navigator.clipboard.readText());
      j.json("share-clipboard", { copied });
      j.expect(copied).toMatch(
        new RegExp(`^Sunset Ridge Daily #${daily.number} · \\d+:\\d\\d\\.\\d\\d( · \\S+)?$`),
      );
    },
  );
});
