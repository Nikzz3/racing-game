import { app, BrowserWindow, Menu, net, protocol, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SERVER_URL = "ws://localhost:8080";
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
      additionalArguments: [`--server-url=${serverUrl}`],
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
});
