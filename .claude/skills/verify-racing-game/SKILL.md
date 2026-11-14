---
name: verify-racing-game
description: Verify Sunset Ridge Racing (this repo's browser racing game) works the way a player sees it. Launches an isolated server + Vite clients + its own Postgres database, drives the game in headless Chromium through Playwright journeys (lobby, rooms, laps, records, pacers, races, daily, controls), and captures screenshot, ARIA, WebSocket and database evidence. A headless bot reaches lap, record and race states without a browser. Use unprompted before calling a client/server/shared change done or pushing it, and whenever asked to prove a game feature works.
---

Which journeys to run for a change, and how to report the result: [docs/agents/verifying.md](../../../docs/agents/verifying.md).

# Verify Sunset Ridge Racing

The player surface is the browser client: a Lobby (Garage → Circuit → Race Setup) that leads into a Room, where a Three.js race scene and HUD render while a Node WebSocket server times laps and writes them to Postgres. The Electron desktop app wraps the same client; the server has no player-facing HTTP API beyond `/healthz`. Learn the domain words (Room, Track, Pacer, Plausible Lap, Daily Challenge, ...) from [CONTEXT.md](../../../CONTEXT.md) before reading the map.

Everything lives in `.claude/skills/verify-racing-game/`. Run every command from the repo root.

- `scripts/verify.sh` is the lifecycle helper: `up`, `doctor`, `run <journey>`, `sql "<query>"`, `down`, `env`.
- `scripts/harness.mjs` is the Playwright library journeys import (players, steps, evidence).
- `journeys/<feature>.mjs` is one runnable journey per feature file; `journeys/lib.mjs` holds the Lobby helpers (`openLobby`, `selectCar`, `openSetupTab`, `createRoom`, `joinRoom`, `driveInputs`).
- `features/` is the verification map. Read [features/README.md](features/README.md) before driving anything, then the feature file you are proving.

## Pick the cheapest check that proves the change

| Tier        | Command                                         | Cost                                  | Proves                                                                                                                                            |
| ----------- | ----------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke       | `scripts/verify.sh smoke`                       | ~50 s, no browser, under 10% CPU      | Server, protocol and persistence: Rooms, a persisted lap with its Replay, the Rival ladder, a Race with a Grid Pacer, a Knockout, the Daily Board |
| One journey | `scripts/verify.sh up`, `run <journey>`, `down` | 10 s to 2.5 min                       | What a player sees for one feature, with screenshots                                                                                              |
| Everything  | `scripts/verify.sh all`                         | ~3 min, every journey on its own slot | The whole map                                                                                                                                     |

Run `smoke` after every server or shared change: it needs no `up` (it starts a server and database of its own and removes them) and nothing renders. Run a journey when the change touches what a player sees, and `all` before a release or after a broad change. `all <journey> <journey>` runs just the ones named, in parallel. `VERIFY_PARALLEL` (default 5) caps how many run at once. Do not raise it far: with all ten at once a starved server has processed a bot's positions in a burst and rejected its lap as implausible (`Implausible lap rejected` in `server.log`, and the bot exits non-zero). Rerun that journey alone before calling it a failure.

## Isolation model

`VERIFY_SLOT=<0-9>` (default `0`) picks an instance. Each slot owns:

- a game server on `8190 + 10·slot` (`npm run start -w @racing/server`, no hot reload);
- the **real** client on `5190 + 10·slot` (`vite`, what players get);
- the **seam** client on `5191 + 10·slot` (`vite` with `VITE_E2E=1`: the same game plus `window.__game` and cheap Lobby rendering, see below);
- a database `racing_verify_<worktree-hash>_s<slot>` on the shared compose Postgres, dropped and recreated empty by every `up`.

These ports avoid `npm run dev` (8080/5173, 8090/5183) and the e2e suite (8081+/5174+). Your own `racing` database and dev servers are never touched: `verify.sh` only kills the process groups it recorded in its pidfiles. Two agents verifying at once must use different slots. `up` refuses a slot whose ports are taken.

### Sandbox

The instance cannot run inside the agent's Bash sandbox: `tsx` fails to create its IPC pipe (`listen EPERM ... tsx-501/*.pipe`) and Chromium needs Mach ports. Run `verify.sh up`, `run`, `bot` and `down` outside the sandbox, when you are authorized to. `doctor` and `sql` also need it, because the sandbox hides other processes and local ports. If running outside the sandbox is not authorized, report the affected features as **unproved** (sandbox), not as passed.

### Rendering

On macOS the journeys' headless Chromium renders WebGL on the GPU (Metal): about 100 fps in a Room, against 18 fps on SwiftShader, and the Lobby loads in a fraction of the time. Elsewhere, and with `VERIFY_GL=software`, it uses SwiftShader, as the e2e suite and CI do. Each `journal.md` names the renderer on its first line. A journey must pass on both: at full speed, states that last seconds under SwiftShader last moments, so poll fast (`intervals: [50]`) for anything transient.

### Postgres must be up

`verify.sh` connects to the compose Postgres (`DATABASE_URL` from the shell or `.env`, else `postgres://postgres:postgres@localhost:5432/racing`; `VERIFY_PG_URL` overrides). If `up` prints `pg: connect ECONNREFUSED`, the database is down. **Ask the user** before running `podman machine start` / `podman compose up -d --no-recreate`. The container is named `racing-game-db-1` (podman's docker-compose) or `racing-game_db_1` (podman-compose).

## Launch

```bash
npm ci                                                   # once per worktree, if node_modules is missing
.claude/skills/verify-racing-game/scripts/verify.sh up   # VERIFY_SLOT=3 ... for another slot
```

`up` (re)creates the slot's database, then starts the server, the real client and the seam client, each in its own process group with logs in `reports/verify/.run/slot<N>/<name>.log`. It waits until `/healthz` answers (the server answers only after `initDb` has created the schema) and both Vite servers serve `index.html`. Ready means it printed:

```text
verify: ready slot 0 — client http://127.0.0.1:5190 seam http://127.0.0.1:5191 server ws://127.0.0.1:8190 db racing_verify_<hash>_s0
```

It takes a few seconds. An empty database is the baseline. Journeys create the Rooms, laps and records they need through the game itself.

## Doctor

```bash
.claude/skills/verify-racing-game/scripts/verify.sh doctor
```

Read-only. It checks that all three pidfile processes are alive, `/healthz` says `ok`, both clients serve `<title>Sunset Ridge Racing</title>`, the slot database has `rooms`, `best_laps`, `replays` and `daily_laps`, and no file under `server/src` or `shared/src` changed since `up`. The server does not hot-reload, so after a server or shared change run `down` then `up`. Client changes hot-reload in both Vite servers. `verify.sh run` refuses an unhealthy slot.

## Drive

```bash
.claude/skills/verify-racing-game/scripts/verify.sh run <journey>   # e.g. run rooms
```

`run` creates a fresh evidence directory and runs `journeys/<journey>.mjs`. The journey prints a step journal and exits `0` only when every step passed. To verify a change, run the journey of every feature it touches. To verify something no journey covers, add a journey and a feature file rather than driving ad hoc, so the map grows with the proof. A new journey looks like this:

```js
import { journey } from "../scripts/harness.mjs";
import { createRoom, openLobby, standings, uid } from "./lib.mjs";

await journey("my-feature", async (j) => {
  const page = await j.player("a"); // build: "real" (default) | "seam"
  await j.step("player opens the Lobby", () => openLobby(page));
  await j.step("player creates a Room", async () => {
    await createRoom(page, { playerName: `P ${uid()}`, roomName: `R ${uid()}` });
    await j.expect(standings(page)).toContainText("P ");
    await j.shot("a", "01-in-room"); // screenshot → evidence dir
  });
  await j.step("row persisted", async () => j.json("rooms", await j.sql("SELECT * FROM rooms")));
});
```

`j.player(id, { build, viewport, init, contextOptions })` opens a player in its own browser context, so each player has their own `localStorage`. Every page's console goes to `<id>-console.log` and every non-streaming WebSocket message goes to `<id>-ws.jsonl`. The 20 Hz `snapshot`/`state` streams are only counted, in `result.json`. `j.received(id, type)` returns the parsed server messages of one type. `j.aria(id, label, selector)`, `j.json(label, data)` and `j.note(text)` add evidence. `j.state(id)` reads `window.__game.state()` on seam pages. `VERIFY_HEADED=1` shows the browser.

Handles to prefer, in order: ARIA roles and names (`getByRole("button", { name: "Create & Race" })`, `getByLabel("Driver", { exact: true })`), then the game's data attributes (`.lobby-deck[data-screen]`, `.garage-card[data-variant]`, `.track-card[data-track]`, `[data-setup-tab]`), then classes (`.room-row`, `.hud-standings`). Never use coordinates.

### Bot: get to the end without driving

Never drive a car in a browser just to reach a state. `scripts/bot.ts` is a headless driver that plays over the real WebSocket protocol: it says hello, creates or joins a Room (or the Daily Room), and sends its car's pose every 50 ms like the game client. No browser, no WebGL, about 2% CPU. The game sees an ordinary driver: other players see the car, the name and the standings.

```bash
S=.claude/skills/verify-racing-game/scripts/verify.sh
$S bot --name Rival --create "Warp Room" --mode warp --laps 2                 # 2 laps in ~3 s
$S bot --name Ace --variant suv --create "Rec Room" --mode drive              # 1 Plausible Lap in ~30 s → Track Record + Replay
$S bot --name Slow --join "Rec Room" --mode drive --pace 0.8                  # a slower Plausible Lap (~31 s vs ~28 s)
$S bot --name Ann --create "Race Room" --mode warp --laps race &              # waits for a Race, then drives it out
$S bot --name Ben --join "Race Room" --mode warp --start race                 # calls a 3-lap Race, finished ~5 s after GO
$S bot --name Daily --daily --mode drive                                      # a Plausible Lap in today's Daily Room
$S bot --name Filler --join "My Room" --mode idle --stay forever              # just present: a second driver, a Grid slot
```

| Mode    | What it sends                                                         | Time                            | What it proves and leaves behind                                                                                                           |
| ------- | --------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `drive` | Real `CarPhysics` + the game's racing-line driver at 60 Hz, real time | ~28 s/lap (Sunset Ridge Medium) | A **Plausible Lap**: `lap` message, `best_laps` + `replays` rows, Standings, Medals, Rival ladder, Daily Board, Grid Pacers                |
| `warp`  | Teleports to the gate the server says is owed, every 120 ms           | ~1.5 s/lap                      | Laps that **count in the Room** (HUD laps, session best, Race positions, finish, results) but are implausible, so **nothing is persisted** |
| `idle`  | Its spawn (or Grid slot) pose                                         | —                               | Presence only                                                                                                                              |

Flags: `--name` (required); one of `--create <room>` (with `--track sunset-ridge|stormhaven|arrowhead`, `--difficulty easy|medium|hard`), `--join <room>` or `--daily`; `--variant <car>`; `--mode`; `--laps <n>|race` (default 1; `race` sits until a Race it is on the Grid of runs, then drives it out); `--start race|knockout` (calls one on joining, implies `--laps race`); `--pace <0-1>` (caps the speed the driver brakes to, for slower laps); `--stay <s>|forever` (stays in the Room after finishing; default 0, or `forever` for `idle`); `--timeout <s>` (default 300).

Output is JSON lines: `welcome`, `joined`, `lap` (`laps`, `lapTimeMs`, `isPersonalBest`, `isTrackRecord`), `race` (`phase`, own `slot`/`laps`/`status`, `order`), `standings` (after a persisted lap), `daily`, `done` (`persisted: true` when the server stored the last lap; a `drive` bot waits up to 5 s for that), `closed`; `error` on a usage or connection problem. It exits `0` once its laps or Race are done. It exits non-zero on timeout, on a usage, connection or server error (such as a Knockout with one car), and when a `drive` lap was not persisted. Server lap times on these lines are wall-clock based: compare them (`--pace` orders laps), never assert their values.

In a journey, `j.bot(id, flags)` spawns the same CLI, logs it to `bot-<id>.jsonl` in the evidence dir and returns `{ events, until(event, pred?), done }`. A journey's own browser players watch, join or race against the bot, and `journey()` kills any bot still running at the end. `journeys/races.mjs` is the fullest example: a `drive` bot lays down a Grid Pacer, warp bots finish a Race and a Knockout, and real-build players watch, go DNF and spectate.

Why `drive` cannot be faster: the server times laps on its own arrival clock and rejects a lap whose path beats the Difficulty's speed bound (ADR-0005), so a persisted lap always costs real time. Run several `drive` bots in parallel instead, because they cost no CPU. Use the browser to drive only when the browser's own driving is the thing being proven (HUD lap timing, keyboard/touch/gamepad, the award a driver sees after their own lap).

### Real build vs seam build

Use the **real** client by default: it is what players get. The **seam** client exists for one thing the real one cannot do repeatably: drive a lap. `window.__game.inject(CarInput[])` replaces the keyboard with recorded inputs (`e2e/lap-inputs.json` is one Plausible Lap of Sunset Ridge at Medium) and steps the real physics in real time. Everything downstream is real: network, server checkpoint validation, lap timing, Postgres. A full lap takes about 40 s of wall time and cannot be sped up, because the server rejects a faster-than-real-time lap as implausible. The seam build also skips the Lobby's three WebGL stages (garage, circuit, thumbnails), so never prove Lobby visuals on it.

## Evidence

Each `run` writes `reports/verify/<YYYYMMDD-HHMMSS>-s<slot>-<journey>/` (gitignored):

- `journal.md` lists the steps with pass/fail, timings and the artifacts each produced;
- `result.json` holds the machine-readable status, per-step errors and WebSocket stream counts;
- `*.png` and `*.aria.yml` capture what the player saw at each step, plus `failure-<id>.png` on failure;
- `<id>-ws.jsonl` and `<id>-console.log` record what crossed the wire and what the page logged;
- `*.json` holds database rows and server messages the journey asserted on, plus `bot-<id>.jsonl` for each bot;
- `server.log` is the game server's output during the run (empty on a healthy run). Database and socket errors land here, and so does `Implausible lap rejected: player=… lapTimeMs=… minLapMs=…`: the server tells the driver nothing (ADR-0005), so this line is how you learn a lap was not persisted. Every `warp` lap logs one.

`result.json` records the revision (`commit`, and `dirty` when `client/`, `server/`, `shared/` or `desktop/` have uncommitted changes). A proof is only for that revision. `verify.sh sql` and `j.sql` connect read-only, so a journey cannot seed state even by accident.

Proof standards:

- Drive the player's path. Click the Lobby's controls, not `localStorage` or hand-written WebSocket sends from a browser page. Two stand-ins are allowed: the seam's input injection, for a browser player's own lap, and the bot, which is another player driving the real protocol.
- Capture the action and the resulting state: a screenshot after each meaningful step, not just the last.
- Verify side effects alongside the screen. A lap is proven by the HUD **and** the `best_laps`/`replays` rows **and** the server's `lap`/`leaderboard` messages. A Room is proven by the HUD and the `rooms` row.
- Never assert a numeric server lap time. The server times laps off its own wall clock, so assert positions, names and presence.
- Never seed the database to make a journey pass. If a journey needs a lap on the board, a bot drives one (`--mode drive`). A missing precondition is a reported failure, and its reason goes in the feature's `Gotchas`.
- Report a feature as verified only through the entry points you actually drove. The map lists every entry point.

## Cleanup

```bash
.claude/skills/verify-racing-game/scripts/verify.sh down     # same VERIFY_SLOT as up
```

`down` sends `SIGTERM` (then `SIGKILL`) to the three process groups it started, drops the slot database and removes `reports/verify/.run/slot<N>/`. Evidence directories under `reports/verify/` survive. Delete them by hand when they are no longer needed. Run `down` after every failed `up` or journey iteration too, so no slot is left holding ports. Never kill by process name (`pkill node`, `pkill vite`): the user's own dev servers are node and vite too.

## Helpers

| Command                                  | What it does                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `scripts/verify.sh smoke`                | Browser-free check by bots on a server of its own; no `up` needed        |
| `scripts/verify.sh all [journeys]`       | Every journey (or those named) in parallel, one slot each: up, run, down |
| `scripts/verify.sh up`                   | Fresh DB + server + real client + seam client for `VERIFY_SLOT`          |
| `scripts/verify.sh doctor`               | Read-only health check; non-zero exit when unhealthy                     |
| `scripts/verify.sh run <journey> [args]` | Run `journeys/<journey>.mjs` with a new evidence dir                     |
| `scripts/verify.sh bot [flags]`          | Headless protocol driver: `drive` / `warp` / `idle` (see Bot)            |
| `scripts/verify.sh sql "<query>"`        | Read the slot database (rows as JSON), for side-effect checks            |
| `scripts/verify.sh down`                 | Kill what `up` started, drop the slot DB, keep evidence                  |
| `scripts/verify.sh env`                  | Print the slot's `VERIFY_*` ports, URLs and paths                        |
| `scripts/pg.mjs`                         | Postgres client `verify.sh` uses (no host `psql` needed)                 |
