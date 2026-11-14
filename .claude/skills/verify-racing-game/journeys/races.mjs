// features/races.md — real-build drivers call a Race and a Knockout from the HUD and watch
// them run to results, while headless bots do the driving: a `drive` bot lays down the Replay
// a Grid Pacer plays, and `warp` bots finish race laps in seconds.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { journey } from "../scripts/harness.mjs";
import { createRoom, joinRoom, openLobby, openSetupTab, standings, uid } from "./lib.mjs";

const id = uid();
const RACE_ROOM = `Verify Race ${id}`;
const KO_ROOM = `Verify KO ${id}`;
// The server cuts names to 16 characters.
const A = `Alpha ${id}`;
const B = `Bravo ${id}`;
const C = `Charlie ${id}`;
const PETE = `Pete ${id}`; // drive bot: the Grid Pacer's Replay
const ANN = `Ann ${id}`; // warp bots in the Race
const BEN = `Ben ${id}`;
const CAT = `Cat ${id}`; // warp bots in the Knockout
const DAN = `Dan ${id}`;
const GRACE_MS = 30_000;

await journey("races", async (j) => {
  const a = await j.player("a");
  const b = await j.player("b");
  const c = await j.player("c");
  const bots = {};
  const warpBot = (bid, name, room) =>
    (bots[bid] = j.bot(bid, [
      "--name",
      name,
      "--join",
      room,
      "--mode",
      "warp",
      "--laps",
      "race",
      "--stay",
      "120",
    ]));

  /** Every `race` state the server sent this player, in order (null once a race is over). */
  const races = (who) => j.received(who, "race").map((m) => m.race);
  const raceNames = async (page) =>
    (await page.locator(".race-standings .rs-name").allTextContents()).sort((a, b) =>
      a.localeCompare(b),
    );
  const sorted = (names) => [...names].sort((a, b) => a.localeCompare(b));
  const visible = /\bvisible\b/;
  const row = (page, name) => page.locator(".race-standings tr").filter({ hasText: name });

  await j.step(
    "precondition: no Replay on the Sunset Ridge Medium or Easy board yet (fresh `up`)",
    async () => {
      // Every Replay on a board takes a Grid slot, so the Grids below are exact only on empty boards.
      const replays = await j.sql(
        "SELECT name, difficulty FROM replays WHERE track = 'sunset-ridge'",
      );
      j.expect(replays, "run `verify.sh down` then `up` for empty boards").toEqual([]);
    },
  );

  const pete = j.bot("pete", ["--name", PETE, "--create", `Verify Lap ${id}`, "--mode", "drive"]);
  await j.step(
    "bot Pete drives a Plausible Lap (a Replay on the board) while the players load the Lobby",
    async () => {
      await Promise.all([openLobby(a), openLobby(b), openLobby(c)]);
      j.expect((await pete.until("lap")).laps).toBe(1);
      j.expect(await pete.done).toBe(0);
      const rows = await j.sql("SELECT name, difficulty FROM replays WHERE name = $1", [PETE]);
      j.json("db-pete-replay", rows);
      j.expect(rows).toEqual([{ name: PETE, difficulty: "medium" }]);
    },
  );

  await j.step("A creates the Race Room, B joins, then warp bots Ann and Ben join", async () => {
    await createRoom(a, { playerName: A, roomName: RACE_ROOM });
    await j.expect(standings(a)).toContainText(A);
    await joinRoom(b, { playerName: B, roomName: RACE_ROOM });
    await j.expect(standings(a)).toContainText(B);
    // One after the other, so the Grid (Room join order) is fixed.
    await warpBot("ann", ANN, RACE_ROOM).until("joined");
    await warpBot("ben", BEN, RACE_ROOM).until("joined");
    for (const page of [a, b]) {
      for (const name of [A, B, ANN, BEN]) await j.expect(standings(page)).toContainText(name);
      await j.expect(page.getByRole("button", { name: "Start race", exact: true })).toBeVisible();
      await j
        .expect(page.getByRole("button", { name: "Start knockout", exact: true }))
        .toBeVisible();
    }
    await j.shot("a", "01-a-free-driving-four-drivers");
  });

  await j.step("C picks the Race Room in Race Setup, ready to join", async () => {
    await openSetupTab(c, "race");
    await c.getByLabel("Driver", { exact: true }).fill(C);
    await c.locator(".room-row").filter({ hasText: RACE_ROOM }).click();
  });

  await j.step(
    "A calls a Race: A and B see the RACE standings with the Grid and Pete's Pacer",
    async () => {
      await a.getByRole("button", { name: "Start race", exact: true }).click();
      await j.expect(a.locator(".race-standings h3")).toHaveText("RACE");
      // The Race is on, so C arrives as a Spectator. The Race ends about 35 s after GO
      // (the first finish plus the grace period), which bounds the next three steps.
      await c.getByRole("button", { name: "Join & Race" }).click();
      for (const page of [a, b]) {
        await j.expect(page.locator(".race-standings h3")).toHaveText("RACE");
        await j.expect.poll(() => raceNames(page)).toEqual(sorted([A, B, ANN, BEN, PETE]));
        await j.expect(page.locator(".race-standings tr.pacer .rs-name")).toHaveText(PETE);
        await j.expect(page.locator(".race-position")).toHaveText(/^P[1-5]\/5$/);
        await j.expect(page.locator(".hud-lap")).toHaveText("LAP 1/3");
        await j.expect(page.getByRole("button", { name: "Start race", exact: true })).toBeHidden();
        await j.expect(page.locator(".hud-standings")).toBeHidden();
      }
      await j.shot("a", "02-a-race-grid");
    },
  );

  await j.step(
    "the server counted down, seated the Grid and sent the Pacer: `race` and `racePacers`",
    async () => {
      const countdown = races("a").find((r) => r?.phase === "countdown");
      j.expect(countdown, "a countdown state precedes GO").toBeTruthy();
      j.expect(countdown).toMatchObject({ format: "race", laps: 3 });
      j.expect(typeof countdown.goT).toBe("number");
      // Grid placement: the drivers in Room join order, then the Pacer behind them.
      const slots = Object.fromEntries(countdown.entrants.map((e) => [e.name, e.slot]));
      j.expect(slots).toEqual({ [A]: 0, [B]: 1, [ANN]: 2, [BEN]: 3, [PETE]: 4 });
      j.expect(countdown.entrants.find((e) => e.name === PETE).pacer).toBe(true);
      const pacers = j.received("b", "racePacers").at(-1).pacers;
      j.json(
        "racePacers-b",
        pacers.map(({ id: pid, name, frames }) => ({ id: pid, name, frames: frames.length })),
      );
      j.expect(pacers.map((p) => p.name)).toEqual([PETE]);
    },
  );

  await j.step(
    "Ann and Ben finish all three laps; A's and B's standings show them finished",
    async () => {
      const done = await Promise.all([bots.ann.until("done"), bots.ben.until("done")]);
      j.json("race-bots-done", done);
      for (const d of done) j.expect(d.race.me).toMatchObject({ status: "finished", laps: 3 });
      for (const page of [a, b]) {
        await j.expect(page.locator(".race-standings tr.finished")).toHaveCount(2);
        for (const name of [ANN, BEN])
          await j.expect(row(page, name).locator(".rs-status")).toHaveText(/^\d+:\d{2}\.\d{3}$/);
        await j.expect(row(page, A).locator(".rs-status")).toHaveText("L0/3");
      }
      await j.shot("b", "03-b-bots-finished");
      await j.aria("b", "03-b-race-standings", ".race-standings");
    },
  );

  await j.step("B leaves mid-race: DNF on A's standings while the Race runs on", async () => {
    await b.getByRole("button", { name: "Leave race" }).click();
    await b.locator(".lobby-deck").waitFor();
    await j.expect(row(a, B).locator(".rs-status")).toHaveText("DNF");
    // Out by leaving, not by the grace period: the Race is still running and A still racing.
    const dnf = races("a").find((r) => r?.entrants.find((e) => e.name === B)?.status === "out");
    j.expect(dnf.phase).toBe("racing");
    j.expect(dnf.entrants.find((e) => e.name === A).status).toBe("racing");
    await j.shot("a", "04-a-b-dnf");
  });

  await j.step(
    "C joined mid-race: a Spectator with no car, watching the leader, cycling cars",
    async () => {
      await j.expect(c.locator(".spectator-banner")).toHaveClass(visible);
      // Still racing: A (idle on the Grid) and Pete's Pacer, which leads on its recording.
      await j.expect(c.locator(".spectator-target")).toHaveText(PETE);
      await j.expect(c.locator(".race-position")).toBeHidden();
      await j.expect(c.getByRole("button", { name: "Respawn" })).toBeDisabled();
      j.expect(
        races("c")
          .at(-1)
          .entrants.map((e) => e.name),
      ).not.toContain(C);
      await j.shot("c", "05-c-spectating-leader");
      await c.getByRole("button", { name: "Next car" }).click();
      await j.expect(c.locator(".spectator-target")).toHaveText(A);
      await j.shot("c", "06-c-spectating-next-car");
    },
  );

  await j.step("the grace period runs out: A and C see the RACE RESULTS", async () => {
    for (const page of [a, c]) {
      const results = page.locator(".race-results");
      await j.expect(results).toHaveClass(visible, { timeout: 60_000 });
      await j.expect(results.locator("h2")).toHaveText("RACE RESULTS");
      const names = await results.locator(".rr-name").allTextContents();
      // The two finishers by time, then out by progress: the Pacer, then A, then B (who left first).
      j.expect(sorted(names.slice(0, 2))).toEqual(sorted([ANN, BEN]));
      j.expect(names.slice(2)).toEqual([PETE, A, B]);
      await j.expect(results.locator("li.finished")).toHaveCount(2);
      await j.expect(results.locator("li.out .rr-time")).toHaveText(["DNF", "DNF", "DNF"]);
      await j.expect(results.locator(".race-results-return")).toContainText("Free driving in");
    }
    await j.shot("a", "07-a-race-results");
    await j.shot("c", "08-c-race-results");
    j.json("race-results-a", races("a").at(-1));
  });

  await j.step("the results clear: A and C are free driving again", async () => {
    for (const page of [a, c]) {
      await j.expect(page.locator(".race-results")).not.toHaveClass(visible);
      await j.expect(page.getByRole("button", { name: "Start race", exact: true })).toBeVisible();
      await j.expect(page.locator(".race-position")).toBeHidden();
      for (const name of [A, C, ANN, BEN]) await j.expect(standings(page)).toContainText(name);
    }
    await j.expect(c.locator(".spectator-banner")).not.toHaveClass(visible);
    await j.expect(c.getByRole("button", { name: "Respawn" })).toBeEnabled();
    j.expect(races("c").at(-1)).toBeNull();
    await j.shot("c", "09-c-free-driving-again");
  });

  await j.step(
    "A, alone in a new Easy Room, cannot call a Knockout: it needs two cars",
    async () => {
      await a.getByRole("button", { name: "Leave race" }).click();
      await a.locator(".lobby-deck").waitFor();
      await openSetupTab(a, "race");
      await a.locator('.diff-opt[data-diff="easy"]').click();
      await createRoom(a, { playerName: A, roomName: KO_ROOM });
      await j.expect(standings(a)).toContainText(A);
      await a.getByRole("button", { name: "Start knockout", exact: true }).click();
      await j.expect(a.getByRole("alert")).toContainText("A Knockout needs at least two cars");
      await j.expect(a.locator(".race-standings")).toBeHidden();
      await j.shot("a", "10-a-knockout-needs-two-cars");
      await a.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
    },
  );

  await j.step("warp bots Cat and Dan join the Knockout Room", async () => {
    await warpBot("cat", CAT, KO_ROOM).until("joined");
    await warpBot("dan", DAN, KO_ROOM).until("joined");
    for (const name of [CAT, DAN]) await j.expect(standings(a)).toContainText(name);
    // Toasts last under 4 s; record every one A is shown so the eliminations can be read afterwards.
    await a.evaluate(() => {
      window.__toasts = [];
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.addedNodes)
            if (n.classList?.contains("toast")) window.__toasts.push(n.textContent);
      }).observe(document.querySelector(".toasts"), { childList: true });
    });
  });

  await j.step(
    "A calls a Knockout: 3 cars, 2 laps; A is out the moment both bots complete lap 1",
    async () => {
      await a.getByRole("button", { name: "Start knockout", exact: true }).click();
      const done = await Promise.all([bots.cat.until("done"), bots.dan.until("done")]);
      j.json("knockout-bots-done", done);
      const statuses = done.map((d) => d.race.me.status).sort();
      j.expect(statuses).toEqual(["finished", "out"]);
      const aOut = (race) =>
        race?.format === "knockout" && race.entrants.find((e) => e.name === A)?.status === "out";
      const out = races("a").find(aOut);
      j.json("knockout-a-out-state", out);
      j.expect(out).toMatchObject({ format: "knockout", laps: 2, phase: "racing" });
      for (const name of [CAT, DAN])
        j.expect(out.entrants.find((e) => e.name === name).laps).toBeGreaterThanOrEqual(1);
      // Out by laps, not by the grace period: A heard it well before GO + 30 s.
      j.expect(firstRaceArrival(j, "a", aOut) - out.goT).toBeLessThan(GRACE_MS);
      await j.expect.poll(() => a.evaluate(() => window.__toasts)).toContain(`${A} is out`);
    },
  );

  await j.step(
    "A sees the KNOCKOUT RESULTS: the winner, the bot out on lap 2, then A",
    async () => {
      const results = a.locator(".race-results");
      await j.expect(results).toHaveClass(visible);
      await j.expect(results.locator("h2")).toHaveText("KNOCKOUT RESULTS");
      const names = await results.locator(".rr-name").allTextContents();
      j.expect(sorted(names.slice(0, 2))).toEqual(sorted([CAT, DAN]));
      j.expect(names[2]).toBe(A);
      await j.expect(results.locator("li.finished")).toHaveCount(1);
      await j.expect(results.locator("li.out .rr-time")).toHaveText(["OUT", "OUT"]);
      await j.shot("a", "11-a-knockout-results");
      j.json("knockout-results-a", races("a").at(-1));
    },
  );

  await j.step("the Knockout Room returns to free driving", async () => {
    await j.expect(a.locator(".race-results")).not.toHaveClass(visible);
    await j.expect(a.getByRole("button", { name: "Start knockout", exact: true })).toBeVisible();
    for (const name of [A, CAT, DAN]) await j.expect(standings(a)).toContainText(name);
    await j.shot("a", "12-a-free-driving-after-knockout");
  });

  await j.step(
    "races are not persisted: of everyone here, only Pete's lap is on the board",
    async () => {
      const laps = await j.sql("SELECT name, difficulty FROM best_laps WHERE name = ANY($1)", [
        [A, B, C, PETE, ANN, BEN, CAT, DAN],
      ]);
      j.json("db-best-laps", laps);
      j.expect(laps).toEqual([{ name: PETE, difficulty: "medium" }]);
    },
  );
});

/** When `who` first received a `race` message whose state matches `pred` (host clock, as the server's). */
function firstRaceArrival(j, who, pred) {
  return readFileSync(join(j.env.evidenceDir, `${who}-ws.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((m) => m.dir === "in" && m.type === "race" && pred(JSON.parse(m.payload).race)).t;
}
