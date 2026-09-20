import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
// electron-updater is CommonJS; a default import plus destructure is the ESM-safe shape.
import electronUpdater from "electron-updater";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASES_URL = "https://github.com/Nikzz3/racing-game/releases";
// Dropped into Contents/Resources by scripts/after-pack.cjs when the macOS bundle
// was only ad-hoc signed.
const UNSIGNED_MARKER = "unsigned-build";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  // GLTFLoader hands embedded textures to the browser as blob: URLs and fetches them back.
  "connect-src 'self' blob: data: ws: wss:",
  "worker-src 'self' blob:",
].join("; ");

// During development (`npm run desktop:start`) honour the repo-root `.env` for
// RACING_SERVER_URL / RACING_DEVTOOLS. Packaged apps never carry one. Shell variables win.
if (!app.isPackaged) {
  const envFile = path.resolve(import.meta.dirname, "../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

// Server URL precedence: CLI flag > env > dist/config.json baked by scripts/build.mjs > default.
function bakedServerUrl(): string | undefined {
  const configPath = path.join(import.meta.dirname, "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    return (
      (JSON.parse(readFileSync(configPath, "utf8")) as { serverUrl?: string }).serverUrl ||
      undefined
    );
  } catch (err) {
    console.warn(`desktop: could not parse ${configPath}:`, err);
    return undefined;
  }
}

const serverUrl =
  process.argv
    .find((a) => a.startsWith("--server-url="))
    ?.slice("--server-url=".length)
    .trim() ||
  process.env.RACING_SERVER_URL?.trim() ||
  bakedServerUrl() ||
  "ws://localhost:8080";

const clientDir = app.isPackaged
  ? path.join(process.resourcesPath, "client")
  : path.resolve(import.meta.dirname, "../../client/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
};

/** Map an app:// request to a file inside clientDir, or null if it escapes or is missing. */
function resolveBundleFile(requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return null;
  }
  const file = path.resolve(clientDir, pathname.replace(/^\/+/, "") || "index.html");
  const rel = path.relative(clientDir, file);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !existsSync(file)) return null;
  return file;
}

async function handleAppRequest(request: Request): Promise<Response> {
  const file = resolveBundleFile(request.url);
  if (!file)
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  const upstream = await net.fetch(pathToFileURL(file).href);
  const headers = new Headers(upstream.headers);
  const ext = path.extname(file).toLowerCase();
  if (MIME_TYPES[ext]) headers.set("Content-Type", MIME_TYPES[ext]);
  if (ext === ".html") headers.set("Content-Security-Policy", CSP);
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Must run before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function openExternally(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: "#101614",
    title: "Sunset Ridge Racing",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [`--server-url=${serverUrl}`, `--app-version=${app.getVersion()}`],
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
    openExternally(url);
  });

  void win.loadURL(`${APP_ORIGIN}/index.html`);
  if (process.env.RACING_DEVTOOLS === "1") win.webContents.openDevTools({ mode: "detach" });
}

function installMenu(): void {
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ])
      : null,
  );
}

// --- in-app updates ---------------------------------------------------------
//
// Mirrors `DesktopUpdateState` in client/src/desktop.d.ts. The renderer only ever
// sees this snapshot; electron-updater's own events stay in the main process.
type UpdateState =
  // No check has completed yet; the control shows the version and offers a check.
  | { status: "unchecked" }
  // The last completed check found nothing newer.
  | { status: "idle" }
  | { status: "checking" }
  // electron-updater refuses to run in this install (Linux: the AppImage runtime
  // did not export APPIMAGE, e.g. an extracted bundle or a snap); the control links
  // to the releases page instead.
  | { status: "unsupported" }
  | { status: "available"; version: string; canInstall: boolean }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

let updateState: UpdateState = { status: "unchecked" };

function publishUpdateState(next: UpdateState): void {
  updateState = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("desktop:update", next);
  }
}

function updateBusy(): boolean {
  return updateState.status === "downloading" || updateState.status === "downloaded";
}

/**
 * Wire electron-updater to the renderer. Only meaningful in a packaged build:
 * unpackaged runs have no app-update.yml, so `checkForUpdates` would just log an
 * error; they keep the IPC surface so the always-visible lobby control still works.
 * Updater failures (flaky network, missing release, signature failure) degrade to an
 * `error` state on the control, never to a crashed app.
 *
 * macOS: Squirrel.Mac refuses to install an update into an app that is not
 * code-signed, and electron-updater surfaces that as an `error` after the zip has
 * already been fetched (see MacUpdater.doDownloadUpdate, which rejects on the native
 * updater's error once `autoInstallOnAppQuit` triggers the native check). There is
 * no runtime API that answers "is this bundle signed?", but the afterPack hook
 * knows whether a certificate was in play and leaves an `unsigned-build` marker
 * when it had to ad-hoc sign. Such builds offer the release with `canInstall:
 * false` straight away, skipping a download that could never be installed, and
 * the click opens the releases page so the player can grab the dmg by hand. Should
 * the marker be missing yet the install still fail (a mismatched certificate, say)
 * the `error` listener falls back to the same state. Signed mac builds install in
 * place like Windows and Linux.
 */
function setupAutoUpdater(): void {
  ipcMain.handle("desktop:update:state", () => updateState);
  if (!app.isPackaged) {
    ipcMain.handle("desktop:update:check", () => {});
    ipcMain.handle("desktop:update:install", () => {});
    return;
  }

  const canInstallInPlace =
    process.platform !== "darwin" || !existsSync(path.join(process.resourcesPath, UNSIGNED_MARKER));
  if (!canInstallInPlace)
    console.info("desktop: unsigned macOS build; updates are offered as downloads");

  const updater = electronUpdater.autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.logger = console;

  // Version of the release we are currently offering, so error/progress events can
  // be attributed to it even after electron-updater has moved on.
  let offered: string | null = null;

  updater.on("checking-for-update", () => {
    if (!updateBusy()) publishUpdateState({ status: "checking" });
  });
  updater.on("update-available", (info) => {
    offered = info.version;
    publishUpdateState({
      status: "available",
      version: info.version,
      canInstall: canInstallInPlace,
    });
  });
  updater.on("update-not-available", () => {
    offered = null;
    publishUpdateState({ status: "idle" });
  });
  updater.on("download-progress", (progress) => {
    if (offered === null) return;
    publishUpdateState({
      status: "downloading",
      version: offered,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
    });
  });
  updater.on("update-downloaded", (info) => {
    offered = info.version;
    publishUpdateState({ status: "downloaded", version: info.version });
  });
  updater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("desktop: updater error:", message);
    // A failure while fetching/installing a known release on macOS is almost always
    // the unsigned-bundle case described above; keep the release on offer but hand
    // installation over to the browser.
    if (process.platform === "darwin" && offered !== null && updateState.status !== "idle") {
      publishUpdateState({ status: "available", version: offered, canInstall: false });
    } else {
      publishUpdateState({ status: "error", message });
    }
  });

  const check = (): void => {
    // Never overwrite an in-flight download or a ready-to-install state with the
    // result of a routine re-check.
    if (updateBusy()) return;
    updater.checkForUpdates().then(
      (result) => {
        // electron-updater resolves null without emitting any event when it deems
        // itself inactive (`isUpdaterActive`), which would otherwise leave the control
        // stuck on its pre-check label forever.
        if (result === null) {
          console.warn(
            "desktop: updater is inactive in this install; offering the releases page instead",
          );
          publishUpdateState({ status: "unsupported" });
        }
      },
      // The `error` listener has already published the failure to the renderer.
      (err: unknown) => console.warn("desktop: update check failed:", err),
    );
  };

  ipcMain.handle("desktop:update:check", check);
  ipcMain.handle("desktop:update:install", async () => {
    if (updateState.status === "downloaded") {
      updater.quitAndInstall();
    } else if (
      updateState.status === "unsupported" ||
      (updateState.status === "available" && !updateState.canInstall)
    ) {
      await shell.openExternal(RELEASES_URL);
    } else if (updateState.status === "available") {
      publishUpdateState({ status: "downloading", version: updateState.version, percent: 0 });
      // The `error` listener above has already translated a rejection into renderer
      // state (including the macOS fallback); nothing more to do than keep the app alive.
      await updater
        .downloadUpdate()
        .catch((err: unknown) => console.warn("desktop: update install failed:", err));
    }
  });

  // Check right away rather than on a delay: until a check completes the control can
  // only say "check for updates", and a renderer that loads after the result lands
  // catches up through `desktop:update:state`.
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS).unref();
}

// --- lifecycle --------------------------------------------------------------

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Electron does not emit `ready` until this ESM entry module has finished evaluating,
// so a top-level `await app.whenReady()` would deadlock. Chain on the promise instead.
void app.whenReady().then(() => {
  if (!existsSync(path.join(clientDir, "index.html"))) {
    console.error(
      `desktop: client bundle not found at ${clientDir}. Run \`npm run desktop:build\` from the repo root first.`,
    );
  }
  protocol.handle(APP_SCHEME, handleAppRequest);
  installMenu();
  createWindow();
  setupAutoUpdater();
});
