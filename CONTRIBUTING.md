# Contributing to Sunset Ridge Racing

Everything you need to run, test, and ship the game locally. The player-facing overview
is in [README.md](README.md); the domain glossary is in [CONTEXT.md](CONTEXT.md), the
architecture decisions in [docs/adr/](docs/adr/), and the desktop release flow in
[docs/releasing.md](docs/releasing.md).

## Running locally

Requires a Postgres database (rooms and the best-lap leaderboard are stored there).
For local development, start one with Docker or Podman:

```bash
podman compose up -d
npm install
npm run dev
```

The server connects to `postgres://postgres:postgres@localhost:5432/racing` by default;
set `DATABASE_URL` to override (this is how the deployed environment is configured).

### Environment variables

Every variable has a working default, so no configuration is required. To change one
persistently, copy [`.env.example`](.env.example) to `.env` (gitignored) and uncomment the
line. The file is read by the server, the Vite dev server, the desktop build, the
unpackaged desktop app, and the e2e wrapper (not by Vitest); variables already set in the
shell always take precedence over it,
so `PORT=8090 npm run dev`, CI, and the e2e wrapper behave the same with or without a
`.env`. `.env.example` documents each variable and is the place to add new ones.

- Client: http://localhost:5173
- WebSocket server: ws://localhost:8080

Open the client in multiple tabs/browsers to race together. Select a car, choose a
circuit, then enter a driver name and pick a room: a new one you name, or an open one
listed in the Room field.

### Node version

Node 24 or newer is required (`engines` in `package.json` says `>=24`). `.nvmrc` tracks
the current LTS (`lts/*`), and both GitHub workflows read their Node version from it.

### Working in git worktrees

Each worktree is a separate checkout, so it needs its own `node_modules` and, if you use
one, its own copy of the gitignored `.env`:

```bash
git worktree add ../racing-game-<topic> -b <topic>
cd ../racing-game-<topic>
cp ../racing-game/.env .env 2>/dev/null || true
npm ci --prefer-offline
```

`npm ci` installs from the local npm cache in a few seconds. Everything else is shared:

- **Postgres** — `docker-compose.yml` pins the compose project name to `racing-game`, so
  `podman compose up -d --no-recreate` from any worktree reuses the one `racing-game_db_1`
  container instead of fighting over port 5432. Without `--no-recreate`, podman-compose
  restarts the container on every `up`, which drops the connections of whichever checkout
  is currently serving (data lives in the `racing-game_racing-db` volume and survives).
  All worktrees see the same rooms and leaderboard; run the e2e suite, which provisions
  its own throwaway database, when you need isolation. If your main checkout directory is
  not named `racing-game`, its container and volume still carry the old directory-derived
  name: stop them once with `podman compose -p <directory-name> down` (port 5432 is
  otherwise taken) and let the fixed name create a fresh dev database, or keep the old
  data with `podman volume create racing-game_racing-db` followed by copying
  `/var/lib/postgresql/data` between the two volumes.
- **Ports** — only one checkout can hold 8080/5173 at a time. To run `npm run dev` in a
  second worktree, move both servers: `PORT=8090 CLIENT_PORT=5183 npm run dev`. `PORT` is
  read by the WebSocket server and mirrored into the client bundle so it dials the right
  port; `CLIENT_PORT` moves Vite and makes it fail fast instead of auto-incrementing.
- **The git stash** — it is shared across worktrees. Prefer a WIP commit over `git stash`
  when several sessions are active.

#### T3 Code

[T3 Code](https://t3.codes) reads `t3.json` at the repo root. It declares:

- `defaultThreadEnvMode: "worktree"` — new threads start in a fresh worktree under
  `~/.t3/worktrees/racing-game/`, on a `t3code/<slug>` branch.
- A **Setup worktree** action flagged `runOnWorktreeCreate` that runs `npm ci` and
  `podman compose up -d --no-recreate`. It is marked non-async, so the agent only starts
  once dependencies are installed and the database is up. Copy `.env` by hand if you use
  one; every variable has a working default, so it is optional.
- A **Dev** action that opens the client in the in-app preview. When another thread or
  your main checkout already runs `npm run dev`, start it by hand with
  `PORT=8090 CLIENT_PORT=5183 npm run dev` instead.

T3 Code does not apply `t3.json` automatically to an existing project: open
*Settings → Projects → racing-game → Actions* and use **Import scripts → Import from
t3.json**. The imported actions are stored per machine; the file in the repo is the source
of truth for everyone else. Scripts run with `T3CODE_PROJECT_ROOT` (the main checkout) and
`T3CODE_WORKTREE_PATH` in their environment.

## Project layout

- `shared/` — track spline definition, checkpoints, and the WebSocket message protocol
- `server/` — room manager, server-side checkpoint validation and lap timing, persistent
  leaderboard and room list stored in Postgres
- `client/` — Three.js scene, Blender asset integration, car physics, remote player
  interpolation, lobby and HUD
- `desktop/` — Electron wrapper that ships the built client as a desktop app
- `e2e/` — Playwright browser suite and the wrapper script that provisions its database
- `rl/` — Python port of the car physics plus the PPO trainer that produces the AI
  reference lap policy (see [rl/README.md](rl/README.md))

The rebuilt client has eight cosmetic cars, two circuits, keyboard and touch driving,
live multiplayer, recorded replays, and human or trained AI pacers. The AI reference
lap is available on Sunset Ridge at Medium difficulty. Leaderboards and recordings
remain separated by circuit and difficulty.

The full-screen garage and circuit carousels lead into race setup, online rooms,
and records. Circuit previews use the exact Blender track layouts. The race HUD
shows lap timing, checkpoint progress, a live circuit map, and speed over the sunset
scene. Drag the car to rotate it; switch models with the left/right arrow keys or
on-screen arrow buttons. The circuit carousel also supports swipes. Both carousels
respect reduced motion preferences, and completed progress steps let you go back.

Existing track records and replays remain compatible with the rework. Replay
frames retain their original timestamps, world positions, headings, and speeds;
the speedometer's cosmetic scale never changes saved data or playback. Older
databases gain the default Sunset Ridge/Medium scope on startup. Recordings with
no saved car variant keep the historical driver-name fallback.

`client/src/app.ts` owns lobby, race, and replay transitions. The server separates
WebSocket transport, HTTP/static serving, room membership, and completed-lap storage.
Lap frames are captured before database writes so the next lap can start immediately.

Laps only count when all checkpoints are passed in order (validated server-side), so
cutting the track does not pay off. Best lap times are saved in the database and survive
restarts. Rooms also survive restarts but are automatically closed 1 hour after creation.

The Blender source and editing instructions are in [assets/blender](assets/blender/README.md).
The client loads one shared GLB library and instances roadside geometry. Car geometry
and materials are reused across live drivers, replays, and garage thumbnails.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run build` for local checks.

Some server tests need a real Postgres: the migration check for legacy records and the
SQL-level leaderboard rules (a slower lap never overwrites a personal best). They are
skipped unless `SERVER_TEST_DATABASE_URL` points at a disposable database, and CI
always sets it. Each test creates and removes its own temporary schema and refuses the
developer `racing` database:

```bash
SERVER_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/racing_test npm test -w server
```

## End-to-end tests

Install Chromium once, then run the Playwright suite. The test command starts its own
throwaway Postgres container on a dynamically allocated host port, then one server, one
client, and one database per Playwright worker. Worker `n` uses server port `8081 + n`
and client port `5174 + n`; two workers run by default, and `E2E_WORKERS` changes that
(it is the only supported way to change the worker count, because the servers are
provisioned before Playwright starts):

```bash
npx playwright install chromium
npm run test:e2e
E2E_WORKERS=3 npm run test:e2e
```

Docker must be running. Podman users must expose its Docker-compatible socket and set
`DOCKER_HOST` to that socket before running the suite. If containers are unavailable, set
`E2E_DATABASE_URL` to a Postgres connection URL; the wrapper will use it as the admin
connection instead of starting a container. The suite creates a `racing_e2e_w<n>`
database per worker on that server (the role needs `CREATEDB`) and erases the `rooms`,
`best_laps`, and `replays` tables in them, so you must also set
`E2E_DATABASE_ALLOW_TRUNCATE=1` to confirm the server is disposable — the wrapper
refuses to start without it.

The browser suite also accepts `E2E_CLIENT_PORT` and `E2E_SERVER_PORT` to move the base
ports when the defaults are occupied. It refuses to reuse an existing server process.

Suite conventions, growth rules, and the split between Playwright and Vitest are in
[docs/agents/e2e-testing.md](docs/agents/e2e-testing.md).

## Desktop app development

The `desktop/` workspace wraps the same client in Electron. Instead of talking to the
server that served the page, the desktop build connects to the WebSocket URL baked in at
build time from `RACING_SERVER_URL` (default `ws://localhost:8080`, i.e. a local
`npm run dev` server).

```bash
RACING_SERVER_URL=wss://your-server.example npm run desktop:build
npm run desktop:start
```

`desktop:build` builds the client with a relative Vite base and compiles the Electron
main/preload; `desktop:start` launches it. To package installers locally run
`npm run desktop:dist` — output lands in `desktop/release/` (for the current platform only).

The step-by-step release flow is in [docs/releasing.md](docs/releasing.md). In short: bump
`version` in `desktop/package.json`, then push a matching
`v<version>` tag (e.g. `v0.2.0`) to run `.github/workflows/desktop.yml`. A per-platform
matrix builds the macOS (x64 + arm64 dmg/zip), Windows (x64 nsis) and Linux (x64 AppImage)
installers and uploads them as workflow artifacts; a single `release` job then assembles
them into **one published** GitHub release with generated notes (download table plus
the commits since the previous tag). Pushing the tag is the release act: installed apps
pick the new version up as soon as the workflow finishes. Re-running the workflow on the
same tag updates the release in place. Set the `RACING_SERVER_URL`
repository variable so released installers point at the deployed server; manual
`workflow_dispatch` runs stop at the artifacts and create no release.

Installed apps check GitHub for a newer release on launch and every six hours. The update
button in the lobby header is always visible: it shows the installed version when up to
date (clicking it re-checks) and, when a newer release exists, clicking it downloads the
update and restarts into it. Only **published** releases count (a release you manually turn back into a draft is
invisible to the updater), and in-place install on macOS needs a code-signed app: unsigned macOS builds show a
"Download" button that opens the releases page instead.

Builds are unsigned unless the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets (and, for macOS
notarization, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) are set.
Unsigned installers work, but macOS Gatekeeper and Windows SmartScreen will warn on first
launch. Signing details, the server URL precedence at runtime, and the updater internals
are in [desktop/README.md](desktop/README.md).

On Linux the AppImage is the whole install: `chmod +x Sunset-Ridge-Racing-*.AppImage` and
run it, or add it to Steam as a non-Steam game for Game Mode / Big Picture. AppImages need
FUSE, which Bazzite and other SteamOS-style distros ship out of the box. No deb, rpm,
Flatpak or snap is produced — see
[docs/adr/0007-desktop-distribution-via-electron.md](docs/adr/0007-desktop-distribution-via-electron.md).

## Using Sandcastle

Changes to this repo can be delivered by **Sandcastle**, an AI coding agent that picks up
GitHub issues and opens pull requests for them. You don't touch a branch yourself — you
describe the work in an issue and review the result.

1. **File an issue.** Open a GitHub issue describing the change you want, as concretely as
   possible (what should change, and how you'll know it's done). Add the `sandcastle`
   label so the agent picks it up. To scope a large effort, link the issue to a parent
   PRD; the agent reads the parent for context but only implements the issue it's assigned.

2. **The agent works the issue.** For issue `<N>`, Sandcastle works on a branch named
   `sandcastle/issue-<N>`. It explores the repo, makes the change (test-first where a test
   harness applies), and runs the project's feedback loops — for this repo that's
   `npm test`, `npm run typecheck`, and `npm run build`. Each commit message is prefixed
   `RALPH:` and records what was done, key decisions, the files changed, and notes for the
   next iteration.

3. **Review the pull request.** When the work is ready the agent opens a PR from its
   branch. Review it like any other PR. The agent leaves the issue open and comments its
   progress; closing the issue is a human step after the PR is merged.

Tips for good results: keep one unit of work per issue, spell out acceptance criteria, and
point the agent at relevant files or ADRs (`docs/adr/`) when context matters.
