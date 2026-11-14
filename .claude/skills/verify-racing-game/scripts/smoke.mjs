// Browser-free smoke check: bots play the game over the real protocol and the database is
// read back. Run it through `verify.sh smoke`, which starts a server of its own for it.
// It proves the server, the protocol and persistence — not what a player sees on screen.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const repo = process.env.VERIFY_REPO;
const evidenceDir = process.env.VERIFY_EVIDENCE_DIR;
const require = createRequire(join(repo, "e2e/package.json"));
const { Client } = require("pg");

const uid = Math.random().toString(36).slice(2, 7);
const checks = [];
const children = new Set();
const started = Date.now();

async function sql(text, values = []) {
  const client = new Client({
    connectionString: process.env.VERIFY_DB_URL,
    options: "-c default_transaction_read_only=on",
  });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** A bot (scripts/bot.ts): `events`, `until(event, pred?)`, and `exit` (its exit code). */
function bot(id, args) {
  const child = spawn(
    join(repo, "node_modules/.bin/tsx"),
    [join(import.meta.dirname, "bot.ts"), ...args],
    { cwd: repo, stdio: ["ignore", "pipe", "inherit"] },
  );
  children.add(child);
  const events = [];
  const waiters = new Set();
  const publish = (event) => {
    for (const waiter of waiters) waiter(event);
  };
  let buffered = "";
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      appendFileSync(join(evidenceDir, `bot-${id}.jsonl`), `${line}\n`);
      const event = JSON.parse(line);
      events.push(event);
      publish(event);
    }
  });
  const exit = new Promise((resolve) =>
    child.once("close", (code) => {
      // Remembered like any event, so a wait that starts after the exit fails at once.
      const exited = { event: "exit", code };
      events.push(exited);
      publish(exited);
      resolve(code);
    }),
  );
  return {
    events,
    exit,
    kill: () => child.kill("SIGTERM"),
    until(name, pred = () => true) {
      const hit = events.find((e) => e.event === name && pred(e));
      if (hit) return Promise.resolve(hit);
      const dead = events.find((e) => e.event === "error" || e.event === "exit");
      if (dead)
        return Promise.reject(
          new Error(`bot ${id} ${dead.message ?? `exited (${dead.code})`} before ${name}`),
        );
      return new Promise((resolve, reject) => {
        const waiter = (e) => {
          if (e.event === name && pred(e)) resolve(e);
          else if (e.event === "error") reject(new Error(`bot ${id}: ${e.message}`));
          else if (e.event === "exit")
            reject(new Error(`bot ${id} exited (${e.code}) before ${name}`));
          else return;
          waiters.delete(waiter);
        };
        waiters.add(waiter);
      });
    },
  };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** One named check; they run concurrently and each reports on its own line. */
async function check(id, title, body) {
  const t = Date.now();
  try {
    const detail = await body();
    checks.push({ id, title, status: "passed", ms: Date.now() - t, detail });
    console.log(`ok   ${id} — ${title} (${Date.now() - t} ms)`);
  } catch (error) {
    checks.push({ id, title, status: "failed", ms: Date.now() - t, error: error.message });
    console.log(`FAIL ${id} — ${title}: ${error.message}`);
  }
}

const board = (name) =>
  sql(
    `SELECT b.track, b.difficulty, b.variant, (r.name IS NOT NULL) AS has_replay
     FROM best_laps b LEFT JOIN replays r USING (name, track, difficulty) WHERE b.name = $1`,
    [name],
  );

const ACE = `Ace ${uid}`;
const acePersisted = (async () => {
  const ace = bot("ace", ["--name", ACE, "--variant", "suv", "--create", `Rec ${uid}`]);
  const lap = await ace.until("lap");
  expect((await ace.exit) === 0, "the drive bot's lap was not persisted");
  return lap;
})();

await Promise.all([
  check("lap-persist", "a driven lap becomes a Track Record with its Replay", async () => {
    const lap = await acePersisted;
    expect(lap.isTrackRecord, "first lap on an empty board is not the Track Record");
    const rows = await board(ACE);
    expect(rows.length === 1, `expected 1 best_laps row, found ${rows.length}`);
    expect(rows[0].variant === "suv" && rows[0].has_replay, "row lacks its variant or Replay");
    return rows[0];
  }),

  check("rival-ladder", "a slower driver's Standing names the faster one as Rival", async () => {
    // Started alongside Ace: at pace 0.8 it crosses the line seconds after Ace's lap is stored.
    const slow = bot("slow", ["--name", `Slow ${uid}`, "--create", `Slow ${uid}`, "--pace", "0.8"]);
    const aceLap = await acePersisted;
    const lap = await slow.until("lap");
    const { standings } = await slow.until("standings");
    expect(lap.lapTimeMs > aceLap.lapTimeMs, "the pace 0.8 lap was not slower than pace 1");
    const standing = standings.find((s) => s.track === "sunset-ridge" && s.difficulty === "medium");
    expect(standing?.rival?.name === ACE, `Rival is ${JSON.stringify(standing?.rival)}, not Ace`);
    return standing;
  }),

  check(
    "grid-pacer",
    "a Race seats the Track Record's Replay as a Grid Pacer and finishes",
    async () => {
      await acePersisted;
      const room = `Grid ${uid}`;
      const a = bot("grid-a", [
        "--name",
        `Ga ${uid}`,
        "--create",
        room,
        "--mode",
        "warp",
        "--laps",
        "race",
      ]);
      await a.until("joined");
      const b = bot("grid-b", [
        "--name",
        `Gb ${uid}`,
        "--join",
        room,
        "--mode",
        "warp",
        "--start",
        "race",
      ]);
      const countdown = await b.until("race", (e) => e.phase === "countdown");
      expect(
        countdown.order.some((entry) => entry.startsWith(ACE)),
        "Ace's Replay is not on the Grid",
      );
      const done = await Promise.all([a.until("done"), b.until("done")]);
      expect(
        done.every((d) => d.race.me.status === "finished"),
        "a bot did not finish the Race",
      );
      return { grid: countdown.order };
    },
  ),

  check(
    "daily-board",
    "a lap in the Daily Room lands on the Daily Board and the all-time board",
    async () => {
      const name = `Day ${uid}`;
      const daily = bot("daily", ["--name", name, "--daily"]);
      const joined = await daily.until("joined");
      expect(joined.daily !== undefined, "joinDaily did not land in a Daily Room");
      expect((await daily.exit) === 0, "the Daily lap was not persisted");
      const rows = await sql("SELECT name FROM daily_laps WHERE name = $1", [name]);
      expect(rows.length === 1, `expected 1 daily_laps row, found ${rows.length}`);
      const allTime = await board(name);
      expect(
        allTime[0]?.track === joined.track,
        "the Daily lap is missing from the all-time board",
      );
      return { daily: joined.daily, track: joined.track, difficulty: joined.difficulty };
    },
  ),

  check(
    "room-join",
    "a Room is persisted, listed and joinable; warp laps are never stored",
    async () => {
      const room = `Room ${uid}`;
      const host = bot("host", [
        "--name",
        `Host ${uid}`,
        "--create",
        room,
        "--track",
        "arrowhead",
        "--difficulty",
        "hard",
        "--mode",
        "idle",
      ]);
      await host.until("joined");
      const guestName = `Guest ${uid}`;
      const guest = bot("guest", [
        "--name",
        guestName,
        "--join",
        room,
        "--mode",
        "warp",
        "--laps",
        "2",
      ]);
      const joined = await guest.until("joined");
      expect(
        joined.track === "arrowhead" && joined.difficulty === "hard",
        "the guest got another Room",
      );
      const done = await guest.until("done");
      expect(
        done.laps === 2 && done.persisted === false,
        "warp laps did not count, or were persisted",
      );
      const rows = await sql("SELECT track, difficulty FROM rooms WHERE name = $1", [room]);
      expect(
        rows.length === 1 && rows[0].track === "arrowhead",
        "the rooms row is missing or wrong",
      );
      expect((await board(guestName)).length === 0, "a warp lap reached best_laps");
      host.kill();
      return rows[0];
    },
  ),

  check("knockout", "a Knockout puts the last car out and the other wins", async () => {
    const room = `KO ${uid}`;
    // Easy has no Replay on its board, so no Grid Pacer joins this two-car Knockout.
    const a = bot("ko-a", [
      "--name",
      `Ka ${uid}`,
      "--create",
      room,
      "--difficulty",
      "easy",
      "--mode",
      "warp",
      "--laps",
      "race",
    ]);
    await a.until("joined");
    const b = bot("ko-b", [
      "--name",
      `Kb ${uid}`,
      "--join",
      room,
      "--mode",
      "warp",
      "--start",
      "knockout",
    ]);
    const [first, second] = await Promise.all([a.until("done"), b.until("done")]);
    const statuses = [first.race.me.status, second.race.me.status].sort((x, y) =>
      x.localeCompare(y),
    );
    expect(
      statuses.join() === "finished,out",
      `expected one winner and one out, got ${statuses.join()}`,
    );
    return { statuses };
  }),

  check("knockout-refused", "the server refuses a Knockout with one car", async () => {
    const lone = bot("ko-lone", [
      "--name",
      `Lone ${uid}`,
      "--create",
      `Lone ${uid}`,
      "--difficulty",
      "hard",
      "--start",
      "knockout",
    ]);
    expect((await lone.exit) === 2, "the bot did not exit 2");
    const error = lone.events.find((e) => e.event === "error");
    expect(/at least two cars/.test(error?.message ?? ""), `unexpected error: ${error?.message}`);
    return error.message;
  }),
]);

for (const child of children) child.kill("SIGTERM");
const failed = checks.filter((c) => c.status === "failed");
writeFileSync(
  join(evidenceDir, "result.json"),
  JSON.stringify(
    {
      journey: "smoke",
      status: failed.length ? "failed" : "passed",
      ms: Date.now() - started,
      checks,
    },
    null,
    2,
  ),
);
console.log(
  `\nsmoke: ${failed.length ? "FAILED" : "PASSED"} ${checks.length - failed.length}/${checks.length} in ${Math.round((Date.now() - started) / 1000)} s — evidence in ${evidenceDir}`,
);
process.exit(failed.length ? 1 : 0);
