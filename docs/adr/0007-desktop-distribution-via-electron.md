# Desktop distribution via Electron + electron-builder

The game is a browser client plus a WebSocket server, and some players want a
double-clickable app rather than a URL. We decided to ship native macOS, Windows and Linux
installers from a **separate `desktop` workspace** (`@racing/desktop`) that wraps the
already-built `client/dist` in Electron. The desktop package has **zero runtime
dependencies**: its main and preload scripts are compiled TypeScript with nothing in
`dependencies`, and it never runs Vite or a dev server. The prebuilt client is packaged as
`extraResources` and served over a custom `app://` protocol, so the client is built with
a relative base (`vite build --base=./`) and is otherwise the same bundle the web deploy
ships. Packaging and publishing use **electron-builder**, driven by a `desktop-v*` git tag
that produces a draft GitHub release.

## Considered Options

- **Electron Forge** — rejected. Its opinionated plugin/maker model wants to own the
  bundling step, which we already have in Vite, and it brings a larger dependency tree
  into a package we want to keep runtime-dependency-free.
- **electron-vite (or a Vite plugin for Electron)** — rejected. It couples the desktop
  build to the client's Vite config and dev server, when all the desktop shell needs is
  a finished `client/dist`. Keeping the client build untouched means the web deploy
  cannot regress because of a desktop change.
- **Tauri** — rejected for now. A Rust toolchain on every contributor's and runner's
  machine is a cost the project does not otherwise pay, and the WebView differences across
  platforms would make the Three.js rendering path harder to keep uniform.
- **Loading the client from `file://`** — rejected. Vite's module scripts and asset
  paths behave inconsistently under `file://` and it loosens Electron's security
  defaults; a custom `app://` protocol gives a proper origin.
- **Electron + electron-builder over a prebuilt client (chosen)** — smallest surface: one
  workspace, one config file, GitHub-release publishing built in, and mac/win/linux
  targets from the same tool.

## Consequences

- **The server URL is baked at build time** (`RACING_SERVER_URL` → `dist/config.json`).
  Pointing an installer at a different server means rebuilding; the web client keeps
  deriving its server from the page origin as before.
- **macOS installers require macOS runners.** electron-builder cannot produce mac
  bundles elsewhere, so the release workflow runs a per-OS matrix rather than a single
  Linux job like the rest of CI.
- **Signing and notarization are deferred.** The workflow honours the `CSC_*`/`APPLE_*`
  secrets when present but ships unsigned builds when they are not, accepting Gatekeeper
  and SmartScreen warnings until certificates are procured.
- **Linux ships as an x64 AppImage only.** The target players are on immutable,
  SteamOS-style distros (Bazzite), where a self-contained executable that never involves
  the package manager is the natural fit and can be added to Steam as a non-Steam game.
  deb, rpm, Flatpak and snap would each need their own packaging and repository story
  for no additional reach, so they are not built.
- **The desktop workspace rides the existing root scripts.** `npm run typecheck` fans
  out to all workspaces, so it is typechecked by the normal CI job with no ci.yml change;
  only packaging lives in the separate `desktop.yml` workflow.
- **`desktop/release/` joins `dist/` as build output** and is ignored by git.
