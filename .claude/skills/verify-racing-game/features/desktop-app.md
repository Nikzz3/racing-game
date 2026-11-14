# Desktop app

The desktop app is the same game client in its own Electron window. It opens on the Lobby, dials the WebSocket server baked in when it was built (`RACING_SERVER_URL`), and from there a driver plays exactly as in the browser. The Lobby header looks different: the browser's "Download for macOS, Windows & Linux" link is gone, and an update control shows the installed version.

## Sub-features

- `desktop-build` bakes the server URL given at build time into the app.
- `desktop-launch` opens one window titled `Sunset Ridge Racing` on the Lobby's Garage.
- `desktop-server` connects the Lobby to the baked server (`LIVE MULTIPLAYER`), with no runtime override.
- `desktop-header` drops the download link and shows the update control `v<version> · Check for updates`.
- `desktop-room` creates a Room from the desktop Lobby, then leaves it again.
- `desktop-update-flow` checks for, downloads and installs a newer release (packaged builds only).
- `desktop-links` opens external links (releases page, GitHub) in the system browser, never in the app window.
- `desktop-server-override` lets `--server-url=` or `RACING_SERVER_URL` at launch win over the baked URL.
- `desktop-packaged` is the installer build (`desktop:dist`), with the client bundled into the app.

## How to get to it (user POV)

- Developer: `RACING_SERVER_URL=<ws url> npm run desktop:build`, then `npm run desktop:start`. The app opens on the Lobby.
- Player: install the release for their OS and launch `Sunset Ridge Racing`.
- In the app: the Lobby header's update control (`v<version> · …`), then the same Lobby → Race Setup → `Create & Race` path as [Rooms](./rooms.md).

## Driving it with verify.sh

Preconditions:

- The slot is up and healthy.
- The Electron binary is installed: `node_modules/electron/path.txt` exists. If it does not, run `NODE_USE_ENV_PROXY=1 node node_modules/electron/install.js` (see Gotchas).
- The journey builds the app itself, outside `client/dist` and `desktop/dist`, into `reports/verify/.run/slot<N>/desktop-app/` (removed by `down`). It runs the two halves of `npm run desktop:build` with only the output moved: `npm run build -w @racing/client -- --base=./ --outDir <dir>/client/dist --emptyOutDir`, then `RACING_SERVER_URL=ws://127.0.0.1:<slot server port> node <dir>/desktop/scripts/build.mjs` on a copy of `desktop/`.

Journey: `scripts/verify.sh run desktop-app` (real build in Electron, one driver, about 30 s including the build). The Electron window appears on screen while it runs.

- **Build** (`desktop-build`). Proof: `baked-config.json` holds `serverUrl` = the slot's `ws://127.0.0.1:<port>`.
- **Launch** (`desktop-launch`). The journey launches Electron with Playwright's `_electron`, a fresh `--user-data-dir`, and no `RACING_SERVER_URL` in its environment. Handle: the window URL is `app://bundle/index.html`, the title is `Sunset Ridge Racing`, `.lobby-deck[data-screen="garage"]` is visible, and `.game-loading` is gone. Proof: `01-desktop-lobby.png` shows `CHOOSE YOUR CAR.`, the Daily banner with a `Racer<NNN>` name, and the header.
- **Server** (`desktop-server`). Handle: `getByRole("status")` reads `LIVE MULTIPLAYER`. Proof: `ws-urls.json` lists the slot server's URL, and `desktop-ws.jsonl` records what crossed the wire.
- **Header** (`desktop-header`). Handle: `getByRole("link", { name: /Download the desktop app/ })` has count 0, and `getByRole("button", { name: "v<version> · Check for updates" })` is visible. Clicking it leaves the label unchanged, because an unpackaged app has no updater. Proof: `02-desktop-header.aria.yml` has `link "Credits"`, `button "v0.1.34 · Check for updates"`, `status: LIVE MULTIPLAYER` and no download link. `02-desktop-header.png` shows the same.
- **Room** (`desktop-room`). The driver clicks `.garage-card[data-variant="suv"]`, then follows the [Rooms](./rooms.md) create path. Result: `.hud-standings tbody` lists the driver and `.hud-room` shows the Room name. Proof: `03-desktop-in-room.png` shows the rendered Sunset Ridge scene with the SUV, the Room name and the driver in `BEST LAPS`. `joined-messages.json` holds the server's `joined` message, and `db-rooms.json` holds exactly one `rooms` row with `track = sunset-ridge` and `difficulty = medium`.
- **Leave.** `getByRole("button", { name: "Leave race" })`. Result: `.lobby-deck` is back and `.hud-standings` is gone. Proof: `04-desktop-back-in-lobby.png`.
- **Update flow** (`desktop-update-flow`). **Not yet automated.** It needs a packaged build (`npm run desktop:dist`) older than the latest GitHub release, plus network access to GitHub. Packaging and releasing are out of scope for verification. On unsigned macOS builds, the control reads `Download v<x>` and opens the releases page.
- **External links** (`desktop-links`). **Not yet automated.** Clicking one would open the user's real browser. To prove it, stub `shell.openExternal` through `app.evaluate` and assert the app window's URL stays `app://bundle/index.html`.
- **Server override** (`desktop-server-override`). **Not yet automated.** Relaunch with `--server-url=ws://127.0.0.1:<port>` against a build baked with another URL, and expect `LIVE MULTIPLAYER`.
- **Packaged installer** (`desktop-packaged`). **Not yet automated.** `desktop:dist` builds release artifacts and does not belong in a verification run.

## Gotchas

- Without `--user-data-dir`, an unpackaged Electron run uses `~/Library/Application Support/Sunset Ridge Racing`. That is the **installed** app's profile, so a run overwrites the player's saved driver name and car. The journey always passes a fresh directory and asserts `app.getPath("userData")`.
- Do not run `npm run desktop:build` itself to verify. It writes `client/dist` and `desktop/dist/config.json` in the checkout, which leaves the user's `desktop:start` dialing a slot that is already gone.
- At runtime, `RACING_SERVER_URL` from the shell or the repo-root `.env` beats the baked `config.json`. An unpackaged app loads `../../.env` relative to `desktop/dist`. The journey strips the variable, and its build copy has no `.env` next to it, so only the baked URL can win. A manual `desktop:start` in a checkout with a `.env` may dial another server.
- `npm ci` can leave `node_modules/electron` without its binary: no `dist/` and no `path.txt`. `node_modules/electron/install.js` uses Node's `fetch`, which ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set. Without it, the agent sandbox's proxy fails with `TypeError: fetch failed`.
- The slot server is `8190 + 10·slot` (slot 9 is `8280`). Read it from `j.env.server` and never hard-code it.
- The HUD paints before the GPU's first scene frame, so an early in-Room screenshot shows the HUD over black. The journey waits until the middle of the window is no longer flat black. The `Loading Sunset Ridge` splash (`.game-loading`) likewise covers the Lobby until the garage model loads.
- Electron pages are not harness players: `j.shot`, `j.aria` and `j.received` do not see them. The journey writes its own `desktop-*` evidence and `failure-desktop.png`, then closes Electron (and kills the recorded PID if it is still alive) in a `finally`.
- When the last driver leaves, the server closes the Room: the list reads `NO OPEN ROOMS` and the `rooms` row is deleted. Assert the row while the driver is still in the Room, as the journey does.
