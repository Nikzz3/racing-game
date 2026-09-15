# @racing/desktop

Electron wrapper that ships the prebuilt Vite client (`client/dist`) as a macOS
(dmg/zip, x64 + arm64) or Windows (NSIS x64) desktop app. It has no production
dependencies; the client is served from a privileged `app://bundle/` scheme and
connects to the game server over WebSocket.

## Run in development

```sh
npm run desktop:build   # client with Vite base "./", then tsc + preload + dist/config.json
npm run desktop:start   # electron .
```

Set `RACING_DEVTOOLS=1` to open DevTools on launch. The unpackaged app serves
`../client/dist` directly, so rebuild the client to pick up UI changes.

## Server URL

The client reads `window.desktop.serverUrl` (exposed by the preload) to decide
which WebSocket server to talk to. Precedence at runtime:

1. `--server-url=wss://play.example.com` CLI argument
2. `RACING_SERVER_URL` environment variable
3. `dist/config.json`, baked by `npm run build -w desktop` from `RACING_SERVER_URL`
   at build time
4. `ws://localhost:8080`

For a release build: `RACING_SERVER_URL=wss://play.example.com npm run build -w desktop`.

## Package

```sh
npm run dist:dir -w desktop   # unpacked app in desktop/release/, quick smoke test
npm run dist -w desktop       # installers for the current platform, no publish
```

Cross-building: macOS installers must be built on macOS; Windows NSIS can be
built on Windows or Linux (electron-builder pulls Wine in a Docker image when
needed). Icons come from `build/icon.png`; electron-builder derives `.icns`/`.ico`.

## Signing and notarization

Unsigned builds work but trigger Gatekeeper ("unidentified developer") and
SmartScreen warnings. To sign, export these before `npm run dist`:

- `CSC_LINK`, `CSC_KEY_PASSWORD` – signing certificate (.p12) and its password
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` – notarization
  credentials; also flip `mac.notarize` to `true` in `electron-builder.yml`

See the comments in `electron-builder.yml` for details.
