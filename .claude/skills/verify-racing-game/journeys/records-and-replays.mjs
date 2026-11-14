// features/records-and-replays.md — the Records tab, the AI Record and Jev Lap viewers,
// and a human Replay of a lap a `drive` bot sets, all watched from the real build.
import { readFileSync } from "node:fs";
import { journey } from "../scripts/harness.mjs";
import { openLobby, openSetupTab, uid } from "./lib.mjs";

const id = uid();
// The server truncates driver names to 16 characters.
const DRIVER = `Rec ${id}`;
const ROOM = `Verify Records ${id}`;

/** Milliseconds of playback the viewer shows ("m:ss.mmm / m:ss.mmm"), or -1 before the first frame. */
async function elapsedMs(page) {
  const text = (await page.locator(".replay-time").textContent()) ?? "";
  const match = /^(\d+):(\d\d)\.(\d{3}) \//.exec(text);
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3]) : -1;
}

await journey("records-and-replays", async (j) => {
  const r = await j.player("r"); // real build: browses Records and watches
  const records = r.locator("#setup-records-panel");
  const empty = records.locator(".lb-empty");
  const hud = r.locator(".replay-hud");
  const aiRecord = r.getByRole("button", { name: "▶ Watch AI Record" });
  const jevLap = r.locator("button[data-jev-lap]");
  const row = records.locator(".lb-list li").filter({ hasText: DRIVER });

  /** Two screenshots at least 2 s of playback apart; they must differ (the car and camera moved). */
  async function provePlayback(prefix) {
    await j.expect.poll(() => elapsedMs(r)).toBeGreaterThan(0);
    const first = await elapsedMs(r);
    const early = readFileSync(await j.shot("r", `${prefix}a-early`));
    await j.expect.poll(() => elapsedMs(r)).toBeGreaterThan(first + 2_000);
    const late = readFileSync(await j.shot("r", `${prefix}b-later`));
    j.note(`playback clock advanced from ${first} ms to ${await elapsedMs(r)} ms`);
    j.expect(early.equals(late)).toBe(false);
  }

  /** Exit replay returns to the Lobby with the Records buttons back in view. */
  async function exitReplay() {
    await r.getByRole("button", { name: "Exit replay" }).click();
    await j.expect(hud).toHaveCount(0);
    await j.expect(r.locator(".lobby-deck")).toBeVisible();
    await j.expect(jevLap).toBeVisible();
  }

  await j.step(
    "R opens Records on a fresh database: empty state for Sunset Ridge, Medium",
    async () => {
      await openLobby(r);
      await j.expect(r.locator(".connection-status")).toHaveText("LIVE MULTIPLAYER");
      await openSetupTab(r, "records");
      await j
        .expect(r.getByRole("tab", { name: /Records/ }))
        .toHaveAttribute("aria-selected", "true");
      await j.expect(records.locator(".board-track-label")).toHaveText("Sunset Ridge Circuit");
      await j.expect(empty).toBeVisible();
      await j.expect(empty).toContainText("No laps yet on Sunset Ridge Circuit, Medium.");
      await j.expect(records.locator(".lb-list li")).toHaveCount(0);
      await j.expect(aiRecord).toBeVisible();
      await j.expect(jevLap).toHaveText(/^▶ Watch Jev Lap · \d:\d\d\.\d{3}$/);
      await j.shot("r", "01-records-empty");
      await j.aria("r", "01-records-empty", "#setup-records-panel");
      j.expect(await j.sql("SELECT name FROM best_laps")).toHaveLength(0);
    },
  );

  // The bot's lap costs ~30 s of real time but no CPU: it drives while R browses and
  // watches the AI viewers, and R's Records tab stays open (never reloaded) meanwhile.
  const d = j.bot("d", ["--name", DRIVER, "--variant", "suv", "--create", ROOM, "--mode", "drive"]);

  await j.step(
    "browsing Hard shows its own empty board, the browse note, and no AI buttons",
    async () => {
      const difficulty = r.getByRole("radiogroup", { name: "Records difficulty" });
      await difficulty.getByRole("radio", { name: "Hard" }).click();
      await j.expect(empty).toContainText("No laps yet on Sunset Ridge Circuit, Hard.");
      await j
        .expect(records.locator(".board-note"))
        .toContainText("Browsing only. Your race is still Sunset Ridge Circuit, Medium.");
      await j.expect(aiRecord).toBeHidden();
      await j.shot("r", "02-records-browse-hard");
      await difficulty.getByRole("radio", { name: "Medium" }).click();
      await j.expect(records.locator(".board-note")).toBeHidden();
      await j.expect(aiRecord).toBeVisible();
    },
  );

  await j.step(
    "browsing another Track via the Records track menu, then back to Sunset Ridge",
    async () => {
      const trackMenu = records.getByRole("button", { name: "Records track" });
      const tracks = records.getByRole("listbox", { name: "Records track" });
      await trackMenu.click();
      await j.expect(tracks).toBeVisible();
      await tracks.getByRole("option").filter({ hasNotText: "Sunset Ridge" }).first().click();
      const label = (await records.locator(".board-track-label").textContent())?.trim();
      j.expect(label).not.toBe("Sunset Ridge Circuit");
      await j.expect(empty).toContainText(`No laps yet on ${label}, Medium.`);
      await j.expect(records.locator(".board-note")).toContainText("Browsing only.");
      await j.expect(aiRecord).toBeHidden();
      await j.shot("r", "02b-records-browse-track");
      await trackMenu.click();
      await tracks.getByRole("option", { name: /Sunset Ridge/ }).click();
      await j.expect(records.locator(".board-track-label")).toHaveText("Sunset Ridge Circuit");
      await j.expect(aiRecord).toBeVisible();
    },
  );

  await j.step(
    "R watches the AI Record: viewer opens, playback advances, exit returns to the Lobby",
    async () => {
      await aiRecord.click();
      // The AI Record is baked in the browser from the trained policy on first use.
      await j.expect(hud.locator(".replay-name")).toHaveText("AI Record", { timeout: 60_000 });
      await j.expect(hud.locator(".replay-label")).toHaveText("REPLAY");
      await provePlayback("03");
      await exitReplay();
      // Computed client-side and never persisted: nothing came from the server, no AI row.
      j.expect(j.received("r", "replay")).toHaveLength(0);
      j.expect(await j.sql("SELECT name FROM replays WHERE name <> $1", [DRIVER])).toHaveLength(0);
    },
  );

  await j.step("R watches the Jev Lap with Jev's decisions alongside", async () => {
    await jevLap.click();
    await j.expect(hud.locator(".replay-name")).toHaveText("Jev");
    const panel = r.getByRole("region", { name: "Jev's decisions" });
    await j.expect(panel).toBeVisible();
    const decisions = async () => Number(await panel.locator("[data-jev-decisions]").textContent());
    await j.expect.poll(decisions).toBeGreaterThan(0);
    const firstCount = await decisions();
    await provePlayback("04");
    await j.expect.poll(decisions).toBeGreaterThan(firstCount);
    await j
      .expect(panel.locator('.jev-card[data-question="pedal"] .jev-option[data-picked]'))
      .toHaveCount(1);
    await j
      .expect(panel.locator('.jev-card[data-question="steer"] .jev-option[data-picked]'))
      .toHaveCount(1);
    await j.aria("r", "04-jev-panel", ".replay-hud");
    await exitReplay();
  });

  await j.step("bot D's Plausible Lap is a Track Record with a Replay in Postgres", async () => {
    const lap = await d.until("lap");
    j.json("d-lap-event", lap);
    // First Plausible Lap on an empty board: the server flags it as the Track Record.
    j.expect(lap.isTrackRecord).toBe(true);
    const laps = await j.sql(
      "SELECT name, track, difficulty, variant FROM best_laps WHERE name = $1",
      [DRIVER],
    );
    j.json("db-best-laps", laps);
    j.expect(laps).toEqual([
      { name: DRIVER, track: "sunset-ridge", difficulty: "medium", variant: "suv" },
    ]);
    const replays = await j.sql(
      "SELECT name, track, difficulty, jsonb_array_length(frames) AS frames FROM replays WHERE name = $1",
      [DRIVER],
    );
    j.json("db-replays", replays);
    j.expect(replays).toHaveLength(1);
    j.expect(replays[0].frames).toBeGreaterThan(1);
  });

  await j.step("R's open Records tab shows D's lap live, with a Watch replay button", async () => {
    await j.expect(row).toBeVisible();
    await j.expect(empty).toBeHidden();
    await j.expect(row.getByRole("button", { name: `Watch ${DRIVER} replay` })).toBeVisible();
    const boards = j
      .received("r", "leaderboard")
      .filter((m) => m.entries.some((e) => e.name === DRIVER));
    j.expect(boards.length).toBeGreaterThanOrEqual(1);
    await j.shot("r", "06-records-live-row");
    await j.aria("r", "06-records-live-row", "#setup-records-panel");
  });

  await j.step("after a reload, R's Records still list D's lap (from Postgres)", async () => {
    await openLobby(r);
    await openSetupTab(r, "records");
    await j.expect(row).toBeVisible();
  });

  await j.step(
    "R watches D's Replay: server sends it, viewer plays it, exit returns to the Lobby",
    async () => {
      const boardTime = (await row.locator(".lb-time").textContent())?.trim();
      await row.getByRole("button", { name: `Watch ${DRIVER} replay` }).click();
      await j.expect(hud.locator(".replay-name")).toHaveText(DRIVER);
      // The viewer's total is the lap time the board shows.
      await j.expect(hud.locator(".replay-time")).toContainText(`/ ${boardTime}`);
      const replay = j.received("r", "replay");
      j.expect(replay).toHaveLength(1);
      j.expect(replay[0]).toMatchObject({ name: DRIVER, track: "sunset-ridge", variant: "suv" });
      j.expect(replay[0].frames.length).toBeGreaterThan(1);
      j.json("r-replay-message", { ...replay[0], frames: `${replay[0].frames.length} frames` });
      await provePlayback("07");
      await exitReplay();
      await j.expect(row).toBeVisible();
      await j.shot("r", "08-back-in-lobby");
    },
  );
});
