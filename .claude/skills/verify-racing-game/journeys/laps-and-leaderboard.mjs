// features/laps-and-leaderboard.md — one Plausible Lap on the seam build carries every lap,
// HUD, server, database and Respawn assertion; a second player on the real build reads the board.
import { journey, lapInputs } from "../scripts/harness.mjs";
import { createRoom, driveInputs, openLobby, openSetupTab, standings, uid } from "./lib.mjs";

const id = uid();
const ROOM = `Verify Laps ${id}`;
const A = `Lapper ${id}`; // the server keeps 16 characters of a name
const TRACK = "sunset-ridge";
const DIFFICULTY = "medium";
const CHECKPOINTS = 12;
const NO_TIME = "--:--.---";
const TIME = /^\d+:\d{2}\.\d{3}$/;

/** Record every change of the HUD's lap, Checkpoint and lap-timer readouts, in page time. */
function watchHud() {
  const read = (selector) => document.querySelector(selector)?.textContent ?? "";
  const log = [];
  const sample = () => {
    const entry = {
      t: performance.now(),
      lap: read(".hud-lap"),
      cp: read(".hud-cp"),
      timer: read(".hud-cur-lap"),
    };
    const last = log.at(-1);
    const idle = (e) => e.timer === "--:--.---"; // runs in the page: no access to NO_TIME
    if (!last || last.lap !== entry.lap || last.cp !== entry.cp || idle(last) !== idle(entry))
      log.push(entry);
  };
  sample();
  const observer = new MutationObserver(sample);
  for (const selector of [".hud-lap", ".hud-cp", ".hud-cur-lap"])
    observer.observe(document.querySelector(selector), {
      childList: true,
      characterData: true,
      subtree: true,
    });
  window.__hudLog = log;
}

const cpNumber = (text) => Number(/^CP (\d+)\//.exec(text)?.[1]);

await journey("laps-and-leaderboard", async (j) => {
  const a = await j.player("a", { build: "seam" });
  const hud = (selector) => a.locator(`.hud ${selector}`);
  let start;

  await j.step("A creates a Room on the seam build and waits at the start", async () => {
    await openLobby(a);
    await createRoom(a, { playerName: A, roomName: ROOM });
    await j.expect(standings(a)).toContainText(A);
    await a.waitForFunction(() => window.__game !== undefined);
    await j.expect(hud(".hud-lap")).toHaveText("LAP 0");
    await j.expect(hud(".hud-cp")).toHaveText(`CP 0/${CHECKPOINTS}`);
    for (const field of [".hud-cur-lap", ".hud-last", ".hud-best"])
      await j.expect(hud(field)).toHaveText(NO_TIME);
    start = (await j.state("a")).position;
    await a.evaluate(watchHud);
    await j.shot("a", "01-a-at-start");
  });

  // The lap runs in the page while the next steps watch the HUD; ~40 s of real time.
  const drive = driveInputs(a, lapInputs());
  drive.catch(() => {}); // awaited below; keep an early failure from going unhandled

  await j.step("lap timer starts once the car crosses the start line", async () => {
    await j.expect(hud(".hud-cur-lap")).not.toHaveText(NO_TIME, { timeout: 60_000 });
    await j.expect(hud(".hud-cp")).not.toHaveText(`CP 0/${CHECKPOINTS}`);
    await j.shot("a", "02-a-timer-running");
  });

  await j.step("Checkpoint counter advances mid-lap", async () => {
    await j.expect
      .poll(async () => cpNumber(await hud(".hud-cp").textContent()), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(6);
    await j.shot("a", "03-a-mid-lap");
  });

  await j.step("the lap completes: LAP 1, LAST and BEST shown, server confirms it", async () => {
    await drive;
    await a.waitForFunction(() => window.__game?.state().lapSubmitted === true, undefined, {
      timeout: 15_000,
    });
    await j.expect(hud(".hud-lap")).toHaveText("LAP 1");
    await j.expect(hud(".hud-last")).toHaveText(TIME);
    await j.expect(hud(".hud-best")).toHaveText(TIME);
    await j.shot("a", "04-a-lap-complete");
  });

  await j.step(
    "the HUD saw every Checkpoint in order and the timer start at the line",
    async () => {
      const log = await a.evaluate(() => window.__hudLog);
      j.json("hud-progress-log", log);
      const cps = log
        .map((e) => cpNumber(e.cp))
        .filter((cp, i, all) => i === 0 || cp !== all[i - 1]);
      // 0 at the start, 1 once the line is crossed, ... 11, 0 (start/finish owed), 1 (next lap begun).
      j.expect(cps.slice(0, CHECKPOINTS + 2)).toEqual([...Array(CHECKPOINTS).keys(), 0, 1]);
      // The clock reads --:--.--- until the line is crossed (CP 1/12), then starts within a moment.
      const crossed = log.findIndex((e) => cpNumber(e.cp) === 1);
      const firstTick = log.findIndex((e) => e.timer !== NO_TIME);
      j.expect(log.slice(0, crossed).every((e) => e.timer === NO_TIME)).toBe(true);
      j.expect(firstTick).toBeGreaterThanOrEqual(crossed);
      j.expect(log[firstTick].t - log[crossed].t).toBeLessThan(1000);
    },
  );

  await j.step("BEST LAPS ranks A with a time and one lap", async () => {
    const mine = standings(a).locator("tr.me");
    await j.expect(mine).toContainText(A);
    await j.expect(mine.locator("td").first()).toHaveText("1");
    await j.expect(mine.locator("td.st-time").first()).toHaveText(TIME);
    await j.expect(mine.locator("td.st-time").last()).toHaveText("L1");
    await j.aria("a", "05-a-best-laps", ".hud-standings");
  });

  await j.step(
    "server sent a penalty-free lap and a leaderboard listing A with a Replay",
    async () => {
      const laps = j.received("a", "lap").filter((m) => m.name === A);
      await j.expect
        .poll(() => j.received("a", "leaderboard").some((m) => m.entries.some((e) => e.name === A)))
        .toBe(true);
      const board = j.received("a", "leaderboard").at(-1);
      j.json("lap-messages", laps);
      j.json("leaderboard-message", board);
      j.expect(laps).toHaveLength(1);
      j.expect(laps[0]).toMatchObject({ laps: 1, penaltyMs: 0, isPersonalBest: true });
      j.expect(board.entries).toContainEqual(
        j.expect.objectContaining({
          name: A,
          track: TRACK,
          difficulty: DIFFICULTY,
          hasReplay: true,
        }),
      );
    },
  );

  await j.step("the lap persisted as a best_laps row and a replays row", async () => {
    const best = await j.sql(
      "SELECT name, track, difficulty, variant, date FROM best_laps WHERE name = $1",
      [A],
    );
    const replays = await j.sql(
      "SELECT name, track, difficulty, variant, jsonb_array_length(frames) AS frames FROM replays WHERE name = $1",
      [A],
    );
    j.json("db-best-laps", best);
    j.json("db-replays", replays);
    j.expect(best).toEqual([
      j.expect.objectContaining({ name: A, track: TRACK, difficulty: DIFFICULTY }),
    ]);
    j.expect(replays).toEqual([
      j.expect.objectContaining({ name: A, track: TRACK, difficulty: DIFFICULTY }),
    ]);
    j.expect(replays[0].frames).toBeGreaterThan(1);
  });

  await j.step(
    "Respawn returns the car to the start, abandons the lap, keeps LAP 1 and BEST",
    async () => {
      // Crossing the line began lap 2: it is the lap in progress Respawn abandons.
      await j.expect(hud(".hud-cur-lap")).toHaveText(TIME);
      const best = await hud(".hud-best").textContent();
      await a.getByRole("button", { name: "Respawn" }).click();
      await j.expect(hud(".hud-cur-lap")).toHaveText(NO_TIME);
      await j.expect(hud(".hud-cp")).toHaveText(`CP 0/${CHECKPOINTS}`);
      await j.expect(hud(".hud-lap")).toHaveText("LAP 1");
      await j.expect(hud(".hud-best")).toHaveText(best);
      await j.expect(standings(a).locator("tr.me td.st-time").last()).toHaveText("L1");
      const { position } = await j.state("a");
      j.json("respawn-position", { start, afterRespawn: position });
      j.expect(Math.hypot(position.x - start.x, position.z - start.z)).toBeLessThan(1);
      j.expect(j.received("a", "lap").filter((m) => m.name === A)).toHaveLength(1);
      await j.shot("a", "06-a-respawned");
    },
  );

  // A's Room keeps rendering under software WebGL; its evidence is captured, so free the CPU.
  await a.context().close();
  const b = await j.player("b");

  await j.step("a second player (real build) sees A ranked in the Lobby Records tab", async () => {
    await openLobby(b);
    // The real build covers the Lobby with "Loading your garage" until the 3D garage is ready.
    await b.locator(".game-loading").waitFor({ state: "detached", timeout: 120_000 });
    await openSetupTab(b, "records");
    const names = b.locator(".lb-list .lb-name");
    await j.expect(names).toContainText([A]);
    await j.expect(b.getByRole("button", { name: `Watch ${A} replay` })).toBeVisible();
    // A's place matches the persisted order the server sent B on connect.
    const board = j
      .received("b", "welcome")[0]
      .leaderboard.filter((e) => e.track === TRACK && e.difficulty === DIFFICULTY);
    j.json("b-welcome-board", board);
    j.expect(await names.allTextContents()).toEqual(board.map((e) => e.name));
    await j.aria("b", "07-b-records", "#setup-records-panel");
    await j.shot("b", "07-b-records");
  });
});
