// features/desktop-app.md — build the Electron app against this slot's server, launch it,
// and create a Room from its Lobby.
//
// The build goes to reports/verify/.run/slot<N>/desktop-app/ (removed by `verify.sh down`),
// never to client/dist or desktop/dist: a `desktop:build` there would bake this slot's
// short-lived URL into the user's own desktop build.
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { _electron } from "@playwright/test";
import { journey } from "../scripts/harness.mjs";
import { createRoom, selectCar, standings, uid } from "./lib.mjs";

const id = uid();
const ROOM = `Desktop Room ${id}`;
const DRIVER = `Desk ${id}`;

await journey("desktop-app", async (j) => {
  const { repo, evidenceDir, slot } = j.env;
  const serverUrl = j.env.server.replace(/^http/, "ws");
  const build = join(repo, "reports/verify/.run", `slot${slot}`, "desktop-app");
  const electronBin = createRequire(join(repo, "package.json"))("electron");
  let app;
  let page;
  let pid;

  // Electron pages are not harness players: screenshot, ARIA and the ws log go here.
  const shot = async (label) => {
    await page.screenshot({ path: join(evidenceDir, `${label}.png`) });
    j.note(`screenshot \`${label}.png\``);
  };
  const aria = async (label, selector) => {
    writeFileSync(
      join(evidenceDir, `${label}.aria.yml`),
      await page.locator(selector).ariaSnapshot(),
    );
    j.note(`aria \`${label}.aria.yml\``);
  };

  try {
    await j.step("the Electron binary is installed", () => {
      j.expect(existsSync(electronBin), `no Electron binary at ${electronBin}`).toBe(true);
      j.note(`electron ${execFileSync(electronBin, ["--version"], { encoding: "utf8" }).trim()}`);
    });

    await j.step(`build the desktop app with RACING_SERVER_URL=${serverUrl}`, () => {
      rmSync(build, { recursive: true, force: true });
      mkdirSync(join(build, "desktop"), { recursive: true });
      // Client half of `npm run desktop:build`, with only the output directory moved.
      execFileSync(
        "npm",
        [
          "run",
          "build",
          "-w",
          "@racing/client",
          "--",
          "--base=./",
          "--outDir",
          join(build, "client/dist"),
          "--emptyOutDir",
        ],
        { cwd: repo, stdio: "inherit" },
      );
      // Desktop half: the workspace's own build script, run from a copy so dist/ lands here.
      for (const entry of ["package.json", "tsconfig.json", "src", "scripts/build.mjs"])
        cpSync(join(repo, "desktop", entry), join(build, "desktop", entry), { recursive: true });
      const env = { ...process.env, RACING_SERVER_URL: serverUrl };
      execFileSync(process.execPath, [join(build, "desktop/scripts/build.mjs")], {
        cwd: repo,
        env,
        stdio: "inherit",
      });
      const baked = JSON.parse(readFileSync(join(build, "desktop/dist/config.json"), "utf8"));
      j.json("baked-config", baked);
      j.expect(baked.serverUrl).toBe(serverUrl);
    });

    await j.step("the app opens one window on the Lobby", async () => {
      // No runtime override: the baked config.json alone must pick the server.
      const env = { ...process.env };
      delete env.RACING_SERVER_URL;
      delete env.RACING_DEVTOOLS;
      // A fresh profile per run. Without it Electron uses ~/Library/Application Support/
      // Sunset Ridge Racing, the installed app's profile, and overwrites the player's
      // saved driver name and car.
      const userData = join(build, "user-data");
      app = await _electron.launch({
        executablePath: electronBin,
        args: [`--user-data-dir=${userData}`, join(build, "desktop")],
        env,
        cwd: build,
      });
      j.expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(userData);
      pid = app.process().pid;
      j.note(`electron pid ${pid}`);
      page = await app.firstWindow();
      const wsLog = join(evidenceDir, "desktop-ws.jsonl");
      const consoleLog = join(evidenceDir, "desktop-console.log");
      page.on("console", (m) => appendFileSync(consoleLog, `[${m.type()}] ${m.text()}\n`));
      page.on("pageerror", (e) => appendFileSync(consoleLog, `[pageerror] ${e.message}\n`));
      page.on("websocket", (socket) => {
        appendFileSync(
          wsLog,
          `${JSON.stringify({ t: Date.now(), dir: "open", url: socket.url() })}\n`,
        );
        socket.on("framereceived", ({ payload }) => {
          const text = payload.toString();
          let type = "?";
          try {
            type = JSON.parse(text).type;
          } catch {}
          if (type !== "snapshot")
            appendFileSync(
              wsLog,
              `${JSON.stringify({ t: Date.now(), dir: "in", type, payload: text.slice(0, 4000) })}\n`,
            );
        });
      });
      await page.locator(".lobby-deck").waitFor();
      j.expect(page.url()).toBe("app://bundle/index.html");
      await j.expect(page).toHaveTitle("Sunset Ridge Racing");
      j.expect(app.windows()).toHaveLength(1);
      await j.expect(page.locator(".lobby-deck")).toHaveAttribute("data-screen", "garage");
      // The "Loading Sunset Ridge" splash covers the Lobby until the garage model is in.
      await j.expect(page.locator(".game-loading")).toHaveCount(0, { timeout: 60_000 });
      await j.expect(page.getByRole("heading", { name: "CHOOSE YOUR CAR." })).toBeVisible();
      await shot("01-desktop-lobby");
    });

    await j.step("the Lobby dials the slot server and goes live", async () => {
      await j
        .expect(page.getByRole("status").filter({ hasText: "LIVE MULTIPLAYER" }))
        .toBeVisible({ timeout: 30_000 });
      const urls = readFileSync(join(evidenceDir, "desktop-ws.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((m) => m.dir === "open")
        .map((m) => m.url.replace(/\/$/, ""));
      j.json("ws-urls", urls);
      j.expect(urls).toContain(serverUrl);
    });

    await j.step(
      "desktop-only header: no download link, an update control with the app version",
      async () => {
        const version = JSON.parse(
          readFileSync(join(build, "desktop/package.json"), "utf8"),
        ).version;
        await j.expect(page.getByRole("link", { name: /Download the desktop app/ })).toHaveCount(0);
        const update = page.getByRole("button", { name: `v${version} · Check for updates` });
        await j.expect(update).toBeVisible();
        await aria("02-desktop-header", ".lobby-nav");
        // Unpackaged builds have no updater: a check is a no-op and the label stays put.
        await update.click();
        await j.expect(update).toBeVisible();
        await j.expect(update).toBeEnabled();
        await shot("02-desktop-header");
      },
    );

    await j.step("the driver picks the SUV and creates a Room", async () => {
      await selectCar(page, "suv");
      await createRoom(page, { playerName: DRIVER, roomName: ROOM });
      await j.expect(standings(page)).toContainText(DRIVER, { timeout: 30_000 });
      await j.expect(page.locator(".hud-room")).toHaveText(ROOM);
      // The HUD paints before the GPU's first scene frame: wait until the middle of the
      // window is no longer flat black (a flat PNG compresses to a few hundred bytes).
      const { width, height } =
        page.viewportSize() ??
        (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
      const clip = { x: width / 2 - 200, y: height / 2 - 100, width: 400, height: 200 };
      await j.expect
        .poll(async () => (await page.screenshot({ clip })).byteLength, { timeout: 30_000 })
        .toBeGreaterThan(5_000);
      await shot("03-desktop-in-room");
    });

    await j.step("the server announced the Room and persisted it", async () => {
      const joined = readFileSync(join(evidenceDir, "desktop-ws.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((m) => m.dir === "in" && m.type === "joined")
        .map((m) => JSON.parse(m.payload));
      j.json("joined-messages", joined);
      j.expect(joined.length).toBeGreaterThanOrEqual(1);
      const rows = await j.sql(
        "SELECT id, name, track, difficulty, created_at FROM rooms WHERE name = $1",
        [ROOM],
      );
      j.json("db-rooms", rows);
      j.expect(rows).toHaveLength(1);
      j.expect(rows[0]).toMatchObject({ track: "sunset-ridge", difficulty: "medium" });
    });

    await j.step("Leave race returns the desktop driver to the Lobby", async () => {
      await page.getByRole("button", { name: "Leave race" }).click();
      await page.locator(".lobby-deck").waitFor();
      await j.expect(page.locator(".hud-standings")).toHaveCount(0);
      await shot("04-desktop-back-in-lobby");
    });
  } catch (error) {
    if (page)
      await page.screenshot({ path: join(evidenceDir, "failure-desktop.png") }).catch(() => {});
    throw error;
  } finally {
    await app?.close().catch(() => {});
    if (pid) {
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
        j.note(`electron pid ${String(pid)} killed after close()`);
      } catch {
        j.note(`electron pid ${String(pid)} exited`);
      }
    }
  }
});
