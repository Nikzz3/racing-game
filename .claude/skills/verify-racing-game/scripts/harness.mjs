// Playwright harness for verify-racing-game journeys. Run journeys through
// `verify.sh run <journey>`, which exports the VERIFY_* environment this module reads.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { chromium, expect as baseExpect } from "@playwright/test";

// Software WebGL on a busy host blocks a page for seconds; 5 s (Playwright's default) flakes.
export const expect = baseExpect.configure({ timeout: 30_000 });

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set: run journeys via verify.sh run <journey>`);
  return value;
};

export const env = {
  slot: required("VERIFY_SLOT"),
  /** The real player build. */
  client: `http://127.0.0.1:${required("VERIFY_CLIENT_PORT")}`,
  /** The VITE_E2E build: same game, plus window.__game and cheap lobby rendering. */
  seam: `http://127.0.0.1:${required("VERIFY_SEAM_PORT")}`,
  server: `http://127.0.0.1:${required("VERIFY_SERVER_PORT")}`,
  dbUrl: required("VERIFY_DB_URL"),
  repo: required("VERIFY_REPO"),
  evidenceDir: required("VERIFY_EVIDENCE_DIR"),
};

const SKILL_DIR = join(import.meta.dirname, "..");
const require = createRequire(join(env.repo, "e2e/package.json"));
const { Client } = require("pg");

/** Recorded CarInput[] for one plausible lap of Sunset Ridge at Medium (e2e/lap-inputs.json). */
export const lapInputs = () =>
  JSON.parse(readFileSync(join(env.repo, "e2e/lap-inputs.json"), "utf8"));

/** Read-only side-effect check against this slot's database. */
export async function sql(text, values = []) {
  const client = new Client({
    connectionString: env.dbUrl,
    options: "-c default_transaction_read_only=on",
  });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

// Server→client snapshots and client→server state stream at 20 Hz; count them, log the rest.
const NOISY = new Set(["snapshot", "state"]);

/**
 * Run a journey: `journey("room-join", async (j) => { ... })`. Every `j.step` is
 * journalled to journal.md; the first failure screenshots every open page, marks the
 * run failed, and stops. Writes result.json and exits non-zero on failure.
 */
export async function journey(name, body) {
  mkdirSync(env.evidenceDir, { recursive: true });
  const journal = join(env.evidenceDir, "journal.md");
  const log = (line) => {
    appendFileSync(journal, `${line}\n`);
    console.log(line);
  };
  const headless = process.env.VERIFY_HEADED !== "1";
  // macOS renders headless WebGL on the GPU through Metal: about 100 fps in a Room against
  // 18 on SwiftShader (M3 Max), and it leaves the CPU to the other slots. Elsewhere, and with
  // VERIFY_GL=software, SwiftShader is an explicit choice (docs/agents/e2e-testing.md)
  // rather than a fallback Chromium may remove.
  const gpu =
    (process.env.VERIFY_GL ?? (process.platform === "darwin" ? "gpu" : "software")) === "gpu";
  const browser = await chromium.launch({
    headless,
    args: gpu
      ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
      : ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader-webgl"],
  });
  const pages = new Map();
  const bots = new Set();
  const steps = [];
  const startedAt = new Date().toISOString();
  let status = "passed";
  let failure;
  log(
    `# ${name} — slot ${env.slot}, ${gpu ? "GPU" : "software"} WebGL, ${new Date().toISOString()}\n`,
  );

  const j = {
    env,
    sql,
    expect,
    /** A player in their own browser context (own localStorage). */
    async player(
      id,
      { build = "real", viewport = { width: 1280, height: 720 }, init, contextOptions = {} } = {},
    ) {
      const context = await browser.newContext({
        baseURL: build === "seam" ? env.seam : env.client,
        viewport,
        reducedMotion: "reduce",
        ...contextOptions,
      });
      if (init) await context.addInitScript(init.fn, init.arg);
      const page = await context.newPage();
      const consoleLog = join(env.evidenceDir, `${id}-console.log`);
      const wsLog = join(env.evidenceDir, `${id}-ws.jsonl`);
      const counts = {};
      page.on("console", (m) => appendFileSync(consoleLog, `[${m.type()}] ${m.text()}\n`));
      page.on("pageerror", (e) => appendFileSync(consoleLog, `[pageerror] ${e.message}\n`));
      page.on("websocket", (socket) => {
        const record =
          (dir) =>
          ({ payload }) => {
            let type = "?";
            try {
              type = JSON.parse(payload.toString()).type;
            } catch {}
            if (NOISY.has(type)) {
              counts[`${dir}:${type}`] = (counts[`${dir}:${type}`] ?? 0) + 1;
              return;
            }
            const text = payload.toString();
            // Full payloads: replay/racePacers frames run to tens of kB and j.received parses them.
            appendFileSync(
              wsLog,
              `${JSON.stringify({ t: Date.now(), dir, type, payload: text })}\n`,
            );
          };
        socket.on("framereceived", record("in"));
        socket.on("framesent", record("out"));
      });
      pages.set(id, { page, context, counts });
      return page;
    },
    /** Server→client messages of `type` this player received so far (from the ws log). */
    received(id, type) {
      try {
        return readFileSync(join(env.evidenceDir, `${id}-ws.jsonl`), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
          .filter((m) => m.dir === "in" && m.type === type)
          .map((m) => JSON.parse(m.payload));
      } catch {
        return [];
      }
    },
    async step(title, fn) {
      const started = Date.now();
      try {
        const out = await fn();
        steps.push({ title, status: "passed", ms: Date.now() - started });
        log(`- [x] ${title} (${Date.now() - started} ms)`);
        return out;
      } catch (error) {
        steps.push({
          title,
          status: "failed",
          ms: Date.now() - started,
          error: String(error?.message ?? error),
        });
        log(`- [ ] ${title} — FAILED: ${String(error?.message ?? error).split("\n")[0]}`);
        throw error;
      }
    },
    async shot(id, label) {
      const path = join(env.evidenceDir, `${label}.png`);
      await pages.get(id).page.screenshot({ path });
      log(`  - screenshot \`${label}.png\``);
      return path;
    },
    async aria(id, label, selector = "body") {
      const snapshot = await pages.get(id).page.locator(selector).ariaSnapshot();
      writeFileSync(join(env.evidenceDir, `${label}.aria.yml`), snapshot);
      log(`  - aria \`${label}.aria.yml\``);
      return snapshot;
    },
    json(label, data) {
      writeFileSync(join(env.evidenceDir, `${label}.json`), JSON.stringify(data, null, 2));
      log(`  - data \`${label}.json\``);
    },
    note: (text) => log(`  - ${text}`),
    /**
     * A headless bot driver (scripts/bot.ts) on this slot's server, logged to bot-<id>.jsonl.
     * `args` are bot CLI flags, e.g. ["--name", "Rival", "--create", room, "--mode", "drive"].
     * Returns { events, until(event, pred?), done } — `done` resolves to the exit code.
     */
    bot(id, args) {
      const file = join(env.evidenceDir, `bot-${id}.jsonl`);
      const child = spawn(
        join(env.repo, "node_modules/.bin/tsx"),
        [join(SKILL_DIR, "scripts/bot.ts"), ...args],
        {
          cwd: env.repo,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      bots.add(child);
      const events = [];
      const waiters = new Set();
      let buffered = "";
      child.stdout.on("data", (chunk) => {
        buffered += chunk;
        let newline;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          appendFileSync(file, `${line}\n`);
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue; // stray non-JSON output (e.g. a runtime warning) stays in the log only
          }
          events.push(event);
          for (const waiter of waiters) waiter(event);
        }
      });
      child.stderr.on("data", (chunk) => appendFileSync(file, `# ${chunk}`));
      const done = new Promise((resolve) =>
        child.once("close", (code) => {
          bots.delete(child);
          for (const waiter of waiters) waiter({ event: "exit", code });
          resolve(code);
        }),
      );
      log(`  - bot \`${id}\`: ${args.join(" ")} → \`bot-${id}.jsonl\``);
      return {
        events,
        done,
        /** Resolves with the first (past or future) event named `name` that matches `pred`. */
        until(eventName, pred = () => true, timeoutMs = 300_000) {
          const hit = events.find((e) => e.event === eventName && pred(e));
          if (hit) return Promise.resolve(hit);
          return new Promise((resolve, reject) => {
            const settle = (finish, value) => {
              clearTimeout(timer);
              waiters.delete(waiter);
              finish(value);
            };
            const timer = setTimeout(
              () =>
                settle(reject, new Error(`bot ${id}: no "${eventName}" event in ${timeoutMs} ms`)),
              timeoutMs,
            );
            // A bot that errors or exits will never send the event: fail now, not at the timeout.
            const waiter = (e) => {
              if (e.event === eventName && pred(e)) settle(resolve, e);
              else if (e.event === "error") settle(reject, new Error(`bot ${id}: ${e.message}`));
              else if (e.event === "exit")
                settle(
                  reject,
                  new Error(`bot ${id} exited (code ${e.code}) before "${eventName}"`),
                );
            };
            waiters.add(waiter);
          });
        },
      };
    },
    /** Seam builds only: the game's e2e state (position, lap, pacer, sound, remotes). */
    state: (id) => pages.get(id).page.evaluate(() => window.__game?.state()),
  };

  try {
    await body(j);
  } catch (error) {
    status = "failed";
    failure = String(error?.stack ?? error);
    for (const [id, { page }] of pages) {
      await page.screenshot({ path: join(env.evidenceDir, `failure-${id}.png`) }).catch(() => {});
    }
  } finally {
    const wsCounts = Object.fromEntries([...pages].map(([id, p]) => [id, p.counts]));
    const git = (...args) => {
      try {
        return execFileSync("git", ["-C", env.repo, ...args], { encoding: "utf8" }).trim();
      } catch {
        return "unknown";
      }
    };
    const revision = {
      commit: git("rev-parse", "--short", "HEAD"),
      dirty: git("status", "--porcelain", "--", "client", "server", "shared", "desktop") !== "",
    };
    writeFileSync(
      join(env.evidenceDir, "result.json"),
      JSON.stringify(
        {
          journey: name,
          status,
          slot: env.slot,
          revision,
          startedAt,
          finishedAt: new Date().toISOString(),
          steps,
          failure,
          wsCounts,
        },
        null,
        2,
      ),
    );
    log(`\n**${status.toUpperCase()}** — evidence in ${env.evidenceDir}`);
    if (failure) log(`\n\`\`\`\n${failure}\n\`\`\``);
    for (const child of bots) child.kill("SIGTERM");
    await browser.close();
  }
  process.exitCode = status === "passed" ? 0 : 1;
}
