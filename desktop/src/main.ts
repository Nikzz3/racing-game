import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
// electron-updater is CommonJS; a default import plus destructure is the ESM-safe shape.
import electronUpdater from "electron-updater";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SERVER_URL = "ws://localhost:8080";
const RELEASES_URL = "https://github.com/Nikzz3/racing-game/releases";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const APP_SCHEME = "app";
const APP_HOST = "bundle";
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

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

// --- server URL: CLI flag > env > baked dist/config.json > default ----------

function readBakedServerUrl(): string | undefined {
  const configPath = path.join(import.meta.dirname, "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "serverUrl" in parsed) {
      const url = (parsed as { serverUrl: unknown }).serverUrl;
      if (typeof url === "string" && url.length > 0) return url;
    }
  } catch (err) {
    console.warn(`desktop: could not parse ${configPath}:`, err);
  }
  return undefined;
}

function resolveServerUrl(): string {
  const prefix = "--server-url=";
  const fromArg = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  return (
    fromArg?.trim() ||
    process.env.RACING_SERVER_URL?.trim() ||
    readBakedServerUrl() ||
    DEFAULT_SERVER_URL
  );
}

const serverUrl = resolveServerUrl();

// --- client bundle location -------------------------------------------------

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

/** Map an app:// request to a file inside clientDir, or null if it escapes / is missing. */
function resolveBundleFile(requestUrl: string): string | null {
  const { pathname } = new URL(requestUrl);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" || decoded === "" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(clientDir, relative);
  const rel = path.relative(clientDir, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // traversal guard
  if (!existsSync(file)) return null;
  return file;
}

async function handleAppRequest(request: Request): Promise<Response> {
  const file = resolveBundleFile(request.url);
  if (!file) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  const upstream = await net.fetch(pathToFileURL(file).href);
  const headers = new Headers(upstream.headers);
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (mime) headers.set("Content-Type", mime);
  if (ext === ".html") headers.set("Content-Security-Policy", CSP);
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Must run before app is ready (top-level, before whenReady).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// --- window -----------------------------------------------------------------

function isExternalHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function createWindow(): BrowserWindow {
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
    if (isExternalHttp(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      event.preventDefault();
      if (isExternalHttp(url)) void shell.openExternal(url);
    }
  });

  void win.loadURL(`${APP_ORIGIN}/index.html`);

  if (process.env.RACING_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

function installMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

// --- in-app updates ---------------------------------------------------------
//
// Mirrors the `UpdateState` union in client/src/desktop.d.ts. The renderer only
// ever sees this snapshot; electron-updater's own events stay in the main process.
type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; canInstall: boolean }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

let updateState: UpdateState = { status: "idle" };

function publishUpdateState(next: UpdateState): void {
  updateState = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("desktop:update", next);
  }
}

/**
 * Wire electron-updater to the renderer. Only meaningful in a packaged build:
 * unpackaged runs have no app-update.yml, so `checkForUpdates` would just log an
 * error. Every updater call is wrapped so a flaky network, a missing release or a
 * signature failure degrades to an `error` state on the control, never to a crashed app.
 *
 * macOS: Squirrel.Mac refuses to install an update into an app that is not
 * code-signed, and electron-updater surfaces that as an `error` after the zip has
 * already been fetched (see MacUpdater.doDownloadUpdate, which rejects on the native
 * updater's error once `autoInstallOnAppQuit` triggers the native check). There is
 * no API that answers "is this bundle signed?", and a build-time flag would drift
 * from whatever certificate the CI run actually had. So on darwin we simply try:
 * if a download/install attempt fails we fall back to `available` with
 * `canInstall: false`, and the next click opens the releases page so the player
 * can grab the dmg by hand. Signed mac builds never hit that path and install
 * in place like Windows and Linux.
 */
function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    // Keep the IPC surface so the always-visible lobby control works in dev runs.
    ipcMain.handle("desktop:update:state", () => updateState);
    ipcMain.handle("desktop:update:check", () => {});
    ipcMain.handle("desktop:update:install", () => {});
    return;
  }
  let updater: typeof electronUpdater.autoUpdater;
  try {
    updater = electronUpdater.autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.logger = console;
  } catch (err) {
    console.warn("desktop: auto-updater unavailable:", err);
    return;
  }

  // Version of the release we are currently offering, so error/progress events can
  // be attributed to it even after electron-updater has moved on.
  let offered: string | null = null;

  updater.on("checking-for-update", () => {
    if (updateState.status === "downloading" || updateState.status === "downloaded") return;
    publishUpdateState({ status: "checking" });
  });
  updater.on("update-available", (info) => {
    offered = info.version;
    publishUpdateState({ status: "available", version: info.version, canInstall: true });
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
      return;
    }
    publishUpdateState({ status: "error", message });
  });

  const check = (): void => {
    // Never overwrite an in-flight download or a ready-to-install state with the
    // result of a routine re-check.
    if (updateState.status === "downloading" || updateState.status === "downloaded") return;
    updater.checkForUpdates().catch((err: unknown) => {
      console.warn("desktop: update check failed:", err);
    });
  };

  ipcMain.handle("desktop:update:state", () => updateState);
  ipcMain.handle("desktop:update:check", () => check());
  ipcMain.handle("desktop:update:install", async () => {
    try {
      switch (updateState.status) {
        case "downloaded":
          updater.quitAndInstall();
          return;
        case "available":
          if (!updateState.canInstall) {
            await shell.openExternal(RELEASES_URL);
            return;
          }
          publishUpdateState({
            status: "downloading",
            version: updateState.version,
            percent: 0,
          });
          await updater.downloadUpdate();
          return;
        default:
          return;
      }
    } catch (err) {
      // The `error` listener above has already translated this into renderer state
      // (including the macOS fallback); nothing more to do than keep the app alive.
      console.warn("desktop: update install failed:", err);
    }
  });

  setTimeout(check, 10_000).unref();
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
  try {
    setupAutoUpdater();
  } catch (err) {
    console.warn("desktop: could not set up auto-updater:", err);
  }
});
