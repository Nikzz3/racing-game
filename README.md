# Sunset Ridge Racing

A browser-based 3D multiplayer racing game. Three.js client with arcade driving on two
circuits, a Node.js WebSocket server with a lobby/room system, and a persistent
best-lap leaderboard.

## Running

Requires a Postgres database (rooms and the best-lap leaderboard are stored there).
For local development, start one with Docker or Podman:

```bash
podman compose up -d
npm install
npm run dev
```

Node 24 or newer is required. `.nvmrc` tracks the current LTS (`lts/*`), and both GitHub
workflows read their Node version from it.

The server connects to `postgres://postgres:postgres@localhost:5432/racing` by default;
set `DATABASE_URL` to override (this is how the deployed environment is configured).

- Client: http://localhost:5173
- WebSocket server: ws://localhost:8080

Open the client in multiple tabs/browsers to race together. Select a car, choose a
circuit, then enter a driver name and pick a room: a new one you name, or an open one
listed in the Room field.

## End-to-end tests

Install Chromium once, then run the Playwright suite. The test command starts its own
throwaway Postgres container on a dynamically allocated host port, plus the server and
client on dedicated ports 8081 and 5174:

```bash
npx playwright install chromium
npm run test:e2e
```

Docker must be running. Podman users must expose its Docker-compatible socket and set
`DOCKER_HOST` to that socket before running the suite. If containers are unavailable, set
`E2E_DATABASE_URL` to a Postgres connection URL; the wrapper will use it verbatim instead
of starting a container. The suite erases the `rooms`, `best_laps`, and `replays` tables
of whatever database it runs against, so you must also set
`E2E_DATABASE_ALLOW_TRUNCATE=1` to confirm the database is disposable — the wrapper
refuses to start without it.

## Desktop app (macOS / Windows / Linux)

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

Releases are cut by tagging: bump `version` in `desktop/package.json`, then push a matching
`v<version>` tag (e.g. `v0.2.0`) to run `.github/workflows/desktop.yml`, which builds macOS
(x64 + arm64 dmg/zip), Windows (x64 nsis) and Linux (x64 AppImage) installers and attaches
them to a **draft** GitHub release for review before publishing. Set the
`RACING_SERVER_URL` repository variable so released installers point at the deployed
server; manual `workflow_dispatch` runs skip publishing and upload the installers as
workflow artifacts.

Installed apps check GitHub for a newer release on launch and every six hours, and show an
update button in the lobby header when one exists; clicking it downloads the update and
restarts into it. Only **published** releases count (drafts are invisible to the updater),
and in-place install on macOS needs a code-signed app: unsigned macOS builds show a
"Download" button that opens the releases page instead.

Builds are unsigned unless the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets (and, for macOS
notarization, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) are set.
Unsigned installers work, but macOS Gatekeeper and Windows SmartScreen will warn on first
launch.

On Linux the AppImage is the whole install: `chmod +x Sunset-Ridge-Racing-*.AppImage` and
run it, or add it to Steam as a non-Steam game for Game Mode / Big Picture. AppImages need
FUSE, which Bazzite and other SteamOS-style distros ship out of the box. No deb, rpm,
Flatpak or snap is produced — see `docs/adr/0007-desktop-distribution-via-electron.md`.

## Controls

- `W` — throttle
- `S` — brake / reverse
- `A` / `D` — steer
- `R` — respawn (teleport back to the start, abandon the in-progress lap)

## How it works

- `shared/` — track spline definition, checkpoints, and the WebSocket message protocol
- `server/` — room manager, server-side checkpoint validation and lap timing, persistent
  leaderboard and room list stored in Postgres
- `client/` — Three.js scene, Blender asset integration, car physics, remote player
  interpolation, lobby and HUD

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

Compatibility tests use frames produced by the previous version's writer. To run
the PostgreSQL migration check, set `LEGACY_COMPAT_DATABASE_URL` to a disposable
database and run `npm run test -w server -- legacy-compatibility.test.ts`. The test
creates and removes its own temporary schema; it refuses the developer `racing`
database.

The Blender source and editing instructions are in [assets/blender](assets/blender/README.md).
The client loads one shared GLB library and instances roadside geometry. Car geometry
and materials are reused across live drivers, replays, and garage thumbnails.

`client/src/app.ts` owns lobby, race, and replay transitions. The server separates
WebSocket transport, HTTP/static serving, room membership, and completed-lap storage.
Lap frames are captured before database writes so the next lap can start immediately.

Run `npm test`, `npm run typecheck`, and `npm run build` for local checks. The browser
suite also accepts `E2E_CLIENT_PORT` and `E2E_SERVER_PORT` when its default ports are
occupied. It refuses to reuse an existing server process.

Laps only count when all checkpoints are passed in order (validated server-side), so
cutting the track does not pay off. Best lap times are saved in the database and survive
restarts. Rooms also survive restarts but are automatically closed 1 hour after creation.

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
