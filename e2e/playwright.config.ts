import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { clientPort, clientUrl, serverPort, WORKERS, workerDatabaseUrl } from "./workers";

type WebServer = Extract<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]>[number];

const databaseUrl = process.env.DATABASE_URL ?? "";

/**
 * One server and one Vite dev server per worker (see workers.ts). Playwright's
 * webServer handling owns their lifetime, readiness, and log capture; the fixtures
 * only pick the pair that matches their worker's parallel index.
 */
function workerServers(worker: number): WebServer[] {
  return [
    {
      command: "npm run start -w @racing/server",
      env: {
        DATABASE_URL: databaseUrl && workerDatabaseUrl(databaseUrl, worker),
        PORT: String(serverPort(worker)),
      },
      // Not "/": the server falls back to client/dist/index.html and 404s until the
      // client is built, which Playwright never accepts as ready. Nothing in this suite
      // needs that build — Vite serves the client — so probe liveness directly.
      url: `http://127.0.0.1:${serverPort(worker)}/healthz`,
      // Surfaced in CI logs; a silent webServer timeout is undiagnosable otherwise.
      stdout: "pipe",
      stderr: "pipe",
      // An existing process may use the developer's database, not this run's disposable one.
      reuseExistingServer: false,
    },
    {
      command: `npm run dev:e2e -w @racing/client -- --port ${clientPort(worker)} --strictPort --host 127.0.0.1`,
      env: {
        VITE_SERVER_PORT: String(serverPort(worker)),
      },
      url: clientUrl(worker),
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: false,
    },
  ];
}

export default defineConfig({
  testDir: "./specs",
  // Each worker has its own database and servers, so tests from one spec file can
  // spread across workers; the long lap-driving tests then overlap instead of
  // queueing behind each other.
  workers: WORKERS,
  fullyParallel: true,
  // A full injected lap runs under software WebGL; game-seam.ts budgets 240s for it,
  // which the 30s default test timeout would otherwise cut short.
  timeout: 300_000,
  // Each retry re-pays the timeout above, so 2 retries put a single stuck test at
  // 15 minutes. One retry still absorbs a flake without dominating the job.
  retries: process.env.CI ? 1 : 0,
  // Under software WebGL a page's first race frames compile every shader on the
  // main thread and block it for seconds, during which no snapshot reaches the
  // HUD. The 5s default is tuned for GPU-backed browsers.
  expect: { timeout: 15_000 },
  // The html report only reaches CI as an artifact after the job ends; the list
  // reporter streams per-test progress into the job log so a run that hits the
  // job's wall-clock limit still shows which test it was on.
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report" }]]
    : [["html", { outputFolder: "playwright-report" }]],
  use: {
    // Worker 0's client; fixtures/db.ts re-points each worker at its own.
    baseURL: clientUrl(0),
    trace: "on-first-retry",
    // The garage stage redraws at 30fps for as long as its camera is travelling
    // between cars, and under software WebGL that stalls every carousel click for
    // seconds. Reduced motion lands the camera immediately; nothing in the suite
    // asserts on the animation.
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: Array.from({ length: WORKERS }, (_, worker) => workerServers(worker)).flat(),
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Software WebGL cost scales with canvas size. Tests that assert on layout
        // or take screenshots set the viewport they need themselves.
        viewport: { width: 640, height: 480 },
        launchOptions: {
          // No GPU in CI (or in a headless local run), so the race scene renders on
          // SwiftShader. Chromium's docs/gpu/swiftshader.md deprecate the *silent*
          // WebGL fallback ("WebGL context creation will soon fail instead of falling
          // back to SwiftShader") and give this exact switch triple as the opt-in.
          // Playwright's Chromium launcher (playwright-core 1.61, Chromium class in
          // lib/coreBundle.js) already pushes --enable-unsafe-swiftshader on every
          // platform; it is repeated here so the config does not depend on that. The
          // --use-gl / --use-angle pair makes the backend an explicit choice rather
          // than a fallback that a future Chromium can remove.
          args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader-webgl"],
        },
      },
    },
  ],
});
