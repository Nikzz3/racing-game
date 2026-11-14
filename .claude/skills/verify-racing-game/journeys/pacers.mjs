// features/pacers.md — the Pacer picker, the AI Record Pacer, human Pacers from bot laps, and the
// Rival ladder (picker, "Rival beaten!", the in-Room offer). Needs a fresh `verify.sh up`.
import { journey, lapInputs } from "../scripts/harness.mjs";
import { createRoom, driveInputs, openLobby, openSetupTab, standings, uid } from "./lib.mjs";

const id = uid();
// The ladder, slowest first. Pace orders the bot laps; the seam lap (~39 s) lands between SLOW and ALPHA.
const SLOW = `Slow ${id}`; //   --pace 0.4 → ~56 s, van
const ALPHA = `Alpha ${id}`; // --pace 0.8 → ~31 s, taxi
const ACE = `Ace ${id}`; //     --pace 1   → ~28 s, suv
const B = `Bravo ${id}`;
const C = `Charlie ${id}`;
const NO_PACER = "No Pacer — race alone";
const TIME = "\\d+:\\d{2}\\.\\d{3}";
const AI_OPTION = new RegExp(`^⚑ AI Record — ${TIME}$`);
const plain = (name) => new RegExp(`^⚑ ${name} — ${TIME}$`);
const rival = (name) => new RegExp(`^⚑ Next rival: ${name} — ${TIME}$`);

const options = (page) => page.locator(".pacer-select option").allTextContents();
const picker = (page) => page.getByRole("combobox", { name: "Pacer" });
const chipName = (page) => page.locator(".pacer-chip-name");
const difficulty = (page, name) =>
  page.getByRole("radiogroup", { name: "Difficulty" }).getByRole("radio", { name, exact: true });

/** Change the race Track from Race Setup the way a player does, back to the Race tab. */
async function changeTrack(page, track) {
  await page.getByRole("button", { name: "Change track" }).click();
  await page.locator(`.track-card[data-track="${track}"]`).click();
  await page.getByRole("button", { name: "Select track", exact: true }).click();
  await openSetupTab(page, "race");
}

/** Type a driver name and commit it (change event), which fetches that name's Standings. */
async function nameDriver(page, name) {
  await page.getByLabel("Driver", { exact: true }).fill(name);
  await page.getByLabel("Driver", { exact: true }).press("Tab");
}

await journey("pacers", async (j) => {
  const p = await j.player("p"); // real build: the picker as players get it
  const c = await j.player("c", { build: "seam" }); // AI Record in a Room
  const b = await j.player("b", { build: "seam" }); // climbs the Rival ladder with its own laps
  const state = async (who) => (await j.state(who)) ?? {};
  const pacerOf = async (who) => (await state(who)).pacer;
  const replaysFor = (who, name) => j.received(who, "replay").filter((m) => m.name === name);

  await j.step(
    "precondition: the slot database holds no Replays (fresh `verify.sh up`)",
    async () => {
      const rows = await j.sql("SELECT name FROM replays");
      if (rows.length)
        throw new Error(`replays is not empty (${rows.length} rows): run verify.sh down/up first`);
    },
  );

  await j.step(
    "picker on a fresh DB, Sunset Ridge / Medium: No Pacer and the AI Record only",
    async () => {
      await openLobby(p);
      await openSetupTab(p, "race");
      await j.expect(difficulty(p, "Medium")).toHaveAttribute("aria-checked", "true");
      // The AI Record is baked when the picker first paints; that can take seconds.
      await j.expect.poll(() => options(p), { timeout: 60_000 }).toHaveLength(2);
      const [none, ai] = await options(p);
      j.expect(none).toBe(NO_PACER);
      j.expect(ai).toMatch(AI_OPTION);
      await j.expect(picker(p)).toBeEnabled();
      await j.expect(picker(p)).toHaveValue("-1");
      await j.aria("p", "01-picker-sunset-medium", ".pacer-picker");
      await j.shot("p", "01-picker-sunset-medium");
    },
  );

  await j.step("picker on Easy and Hard: no AI Record, picker disabled", async () => {
    for (const diff of ["Easy", "Hard"]) {
      await difficulty(p, diff).click();
      await j.expect(difficulty(p, diff)).toHaveAttribute("aria-checked", "true");
      await j.expect.poll(() => options(p)).toEqual([NO_PACER]);
      await j.expect(picker(p)).toBeDisabled();
    }
    await j.aria("p", "02-picker-sunset-hard", ".pacer-picker");
    await j.shot("p", "02-picker-sunset-hard");
  });

  await j.step(
    "picker on Stormhaven / Medium: no AI Record; back on Sunset Ridge it returns",
    async () => {
      await difficulty(p, "Medium").click();
      await changeTrack(p, "stormhaven");
      await j.expect(p.locator(".selected-track-name")).toContainText("Stormhaven");
      await j.expect(difficulty(p, "Medium")).toHaveAttribute("aria-checked", "true");
      await j.expect.poll(() => options(p)).toEqual([NO_PACER]);
      await j.expect(picker(p)).toBeDisabled();
      await j.shot("p", "03-picker-stormhaven-medium");
      await changeTrack(p, "sunset-ridge");
      await j.expect.poll(() => options(p), { timeout: 60_000 }).toHaveLength(2);
      j.expect((await options(p))[1]).toMatch(AI_OPTION);
    },
  );

  // Three other drivers put Plausible Laps (with Replays) on the board, in parallel, in their own Rooms.
  const bots = [
    j.bot("slow", [
      "--name",
      SLOW,
      "--variant",
      "van",
      "--create",
      `Pacer Slow ${id}`,
      "--mode",
      "drive",
      "--pace",
      "0.4",
    ]),
    j.bot("alpha", [
      "--name",
      ALPHA,
      "--variant",
      "taxi",
      "--create",
      `Pacer Alpha ${id}`,
      "--mode",
      "drive",
      "--pace",
      "0.8",
    ]),
    j.bot("ace", [
      "--name",
      ACE,
      "--variant",
      "suv",
      "--create",
      `Pacer Ace ${id}`,
      "--mode",
      "drive",
      "--pace",
      "1",
    ]),
  ];

  // While the bots drive: the AI Record, proven by a browser crossing the start line.
  await j.step(
    "C arms the AI Record and creates a Room: chip, police car, hidden before the line",
    async () => {
      await openLobby(c);
      await createRoom(c, { playerName: C, roomName: `Pacer AI ${id}`, pacer: "ai" });
      await j.expect(standings(c)).toContainText(C);
      await j.expect(chipName(c)).toHaveText("AI Record");
      await j.expect
        .poll(async () => (await state("c")).pacerVariant, { timeout: 15_000 })
        .toBe("police");
      await j.expect
        .poll(async () => (await pacerOf("c"))?.frameCount ?? 0, { timeout: 15_000 })
        .toBeGreaterThan(0);
      j.expect(await pacerOf("c")).toMatchObject({ playing: false, visible: false });
      j.json("c-pacer-before-start", await pacerOf("c"));
      await j.shot("c", "04-c-ai-pacer-armed");
    },
  );

  await j.step(
    "C crosses the start line (keyboard W): the translucent AI Pacer starts and pulls away",
    async () => {
      await c.keyboard.down("KeyW");
      try {
        await j.expect
          .poll(async () => (await pacerOf("c"))?.playing, { timeout: 60_000, intervals: [100] })
          .toBe(true);
        // C brakes on the start straight while the AI Record drives on, ahead of C's car.
        await c.keyboard.up("KeyW");
        await c.keyboard.down("KeyS");
        const pacer = await pacerOf("c");
        j.json("c-pacer-playing", pacer);
        j.expect(pacer).toMatchObject({ playing: true, visible: true });
        j.expect(pacer.opacity).toBeGreaterThan(0);
        j.expect(pacer.opacity).toBeLessThan(1);
        await j.shot("c", "05-c-ai-pacer-playing");
      } finally {
        await c.keyboard.up("KeyW");
        await c.keyboard.up("KeyS");
      }
      await j.shot("c", "06-c-ai-pacer-ahead");
      await j.expect
        .poll(async () => (await state("c")).checkpoint, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);
    },
  );

  await j.step(
    "the three bots' laps are Plausible: best_laps + replays rows, in pace order",
    async () => {
      const done = await Promise.all(bots.map((bot) => bot.until("standings")));
      j.json("bot-standings", done);
      const laps = await Promise.all(bots.map((bot) => bot.until("lap")));
      j.json("bot-laps", laps);
      const [slow, alpha, ace] = laps.map((l) => l.lapTimeMs);
      // Order, not values: pace 0.4 < 0.8 < 1.
      j.expect(slow).toBeGreaterThan(alpha);
      j.expect(alpha).toBeGreaterThan(ace);
      const rows = await j.sql(
        "SELECT b.name, b.variant, r.variant AS replay_variant FROM best_laps b JOIN replays r USING (name, track, difficulty) WHERE b.track = 'sunset-ridge' AND b.difficulty = 'medium' ORDER BY b.time_ms DESC",
      );
      j.json("db-board-after-bots", rows);
      j.expect(rows).toEqual([
        { name: SLOW, variant: "van", replay_variant: "van" },
        { name: ALPHA, variant: "taxi", replay_variant: "taxi" },
        { name: ACE, variant: "suv", replay_variant: "suv" },
      ]);
    },
  );

  await j.step("real build, Lobby still open: the bot laps appear in the picker live", async () => {
    // The board is pushed to open Lobbies; p's Standings predate the laps, so no Rival yet.
    await j.expect.poll(() => options(p), { timeout: 30_000 }).toHaveLength(5);
    const opts = await options(p);
    j.expect(opts[0]).toBe(NO_PACER);
    for (const option of [AI_OPTION, plain(SLOW), plain(ALPHA), plain(ACE)])
      j.expect(opts.slice(1).some((o) => option.test(o))).toBe(true);
    await j.aria("p", "07-picker-live-board", ".pacer-picker");
  });

  await j.step(
    "real build: a new driver's Next rival is the slowest lap on the board (Slow)",
    async () => {
      await nameDriver(p, `Delta ${id}`);
      await j
        .expect(p.locator('.pacer-select option[value="rival"]'))
        .toContainText(`Next rival: ${SLOW}`);
      const opts = await options(p);
      // The Rival is listed once, as the Rival; the rest follow fastest first.
      j.expect(opts).toHaveLength(5);
      j.expect(opts[0]).toBe(NO_PACER);
      j.expect(opts[1]).toMatch(rival(SLOW));
      j.expect(opts[2]).toMatch(AI_OPTION);
      j.expect(opts[3]).toMatch(plain(ACE));
      j.expect(opts[4]).toMatch(plain(ALPHA));
      await j.aria("p", "08-picker-next-rival", ".pacer-picker");
      await j.shot("p", "08-picker-next-rival");
    },
  );

  await j.step(
    "B arms the Next rival (Slow) and creates a Room: the Pacer drives Slow's recorded van",
    async () => {
      await openLobby(b);
      await openSetupTab(b, "race");
      await nameDriver(b, B);
      await j
        .expect(b.locator('.pacer-select option[value="rival"]'))
        .toContainText(`Next rival: ${SLOW}`);
      await picker(b).selectOption("rival");
      await j.aria("b", "09-b-picker-rival-armed", ".pacer-picker");
      await createRoom(b, { playerName: B, roomName: `Pacer Ladder ${id}`, pacer: "rival" });
      await j.expect(standings(b)).toContainText(B);
      await j.expect(chipName(b)).toHaveText(SLOW);
      await j.expect.poll(() => replaysFor("b", SLOW).length, { timeout: 15_000 }).toBe(1);
      const replay = replaysFor("b", SLOW)[0];
      j.json("b-replay-slow", { ...replay, frames: `${replay.frames.length} frames` });
      j.expect(replay).toMatchObject({ track: "sunset-ridge", variant: "van" });
      await j.expect
        .poll(async () => (await state("b")).pacerVariant, { timeout: 15_000 })
        .toBe("van");
      await j.expect
        .poll(async () => (await pacerOf("b"))?.frameCount ?? 0)
        .toBe(replay.frames.length);
      j.json("b-variants", {
        own: (await state("b")).variants,
        pacerVariant: (await state("b")).pacerVariant,
      });
      await j.shot("b", "10-b-slow-pacer-armed");
    },
  );

  await j.step(
    "B's own lap beats Slow: `Rival beaten!`, and the Pacer moves up to Alpha's taxi",
    async () => {
      await b.evaluate((inputs) => window.__game.inject(inputs), lapInputs());
      await j.expect
        .poll(async () => (await pacerOf("b"))?.playing, { timeout: 60_000, intervals: [100] })
        .toBe(true);
      j.json("b-pacer-playing", await pacerOf("b"));
      j.expect(await pacerOf("b")).toMatchObject({ visible: true });
      j.expect((await pacerOf("b")).opacity).toBeGreaterThan(0);
      j.expect((await pacerOf("b")).opacity).toBeLessThan(1);
      await j
        .expect(b.locator(".toast", { hasText: "vs Pacer" }).first())
        .toBeVisible({ timeout: 60_000 });
      await b.waitForFunction(() => window.__game?.state().injectionFinished === true, undefined, {
        timeout: 240_000,
      });
      const beaten = b.locator(".toast", { hasText: "Rival beaten!" });
      await j.expect(beaten).toContainText(`Next up: ${ALPHA}`);
      await j.expect(chipName(b)).toHaveText(ALPHA);
      await j.shot("b", "11-b-rival-beaten");
      const after = j.received("b", "standings").filter((s) => s.afterLap);
      j.json("b-standings-after-lap1", after);
      j.expect(after).toHaveLength(1);
      // The server's Standing agrees: B's best is between the rungs, and Alpha is the next one up.
      const board = after[0].standings.find(
        (s) => s.track === "sunset-ridge" && s.difficulty === "medium",
      );
      j.expect(board.rival.name).toBe(ALPHA);
      await j.expect.poll(() => replaysFor("b", ALPHA).length, { timeout: 15_000 }).toBe(1);
      await j.expect
        .poll(async () => (await state("b")).pacerVariant, { timeout: 15_000 })
        .toBe("taxi");
      const rows = await j.sql("SELECT name FROM best_laps WHERE name = $1", [B]);
      j.expect(rows).toHaveLength(1);
    },
  );

  await j.step("B dismisses the Pacer from the HUD chip", async () => {
    await b.getByRole("button", { name: "Dismiss Pacer" }).click();
    await j.expect(b.locator(".pacer-chip")).not.toHaveClass(/visible/);
    await j.expect.poll(async () => (await state("b")).pacer).toBeNull();
    await j.shot("b", "12-b-pacer-dismissed");
  });

  await j.step(
    "B's second lap, without a Pacer: the Room offers Alpha as NEXT RIVAL; Race rival arms it",
    async () => {
      await b.getByRole("button", { name: "Leave race" }).click();
      await b.locator(".lobby-deck").waitFor();
      // In the Lobby, B's Standings now name Alpha as the Rival.
      await openSetupTab(b, "race");
      await j
        .expect(b.locator('.pacer-select option[value="rival"]'))
        .toContainText(`Next rival: ${ALPHA}`);
      await createRoom(b, { playerName: B, roomName: `Pacer Offer ${id}`, pacer: "-1" });
      await j.expect(standings(b)).toContainText(B);
      await j.expect(b.locator(".pacer-chip")).not.toHaveClass(/visible/);
      await driveInputs(b, lapInputs());
      const prompt = b.locator(".rival-prompt");
      await j.expect(prompt).toContainText(`NEXT RIVAL · ${ALPHA}`);
      await j.shot("b", "13-b-next-rival-offered");
      await prompt.getByRole("button", { name: /Race rival/ }).click();
      await j.expect(chipName(b)).toHaveText(ALPHA);
      await j.expect(prompt).toHaveCount(0);
      await j.expect
        .poll(async () => (await state("b")).pacerVariant, { timeout: 15_000 })
        .toBe("taxi");
      await j.shot("b", "14-b-racing-alpha");
      j.json(
        "b-standings-after-lap2",
        j
          .received("b", "standings")
          .filter((s) => s.afterLap)
          .at(-1),
      );
    },
  );

  await j.step(
    "the AI Pacer wrote nothing: only the bots' and B's laps are on the board",
    async () => {
      const replays = await j.sql("SELECT name FROM replays ORDER BY name");
      j.json("db-replays-final", replays);
      j.expect(replays.map((r) => r.name).sort()).toEqual([ACE, ALPHA, B, SLOW].sort());
    },
  );
});
