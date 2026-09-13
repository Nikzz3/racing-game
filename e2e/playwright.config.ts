import { defineConfig, devices } from "@playwright/test";

const clientPort = process.env.E2E_CLIENT_PORT ?? "5174";
const serverPort = process.env.E2E_SERVER_PORT ?? "8081";
const clientUrl = `http://127.0.0.1:${clientPort}`;

export default defineConfig({
  testDir: "./specs",
  workers: 1,
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
    baseURL: clientUrl,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run start -w @racing/server",
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        PORT: serverPort,
      },
      // Not "/": the server falls back to client/dist/index.html and 404s until the
      // client is built, which Playwright never accepts as ready. Nothing in this suite
      // needs that build — Vite serves the client — so probe liveness directly.
      url: `http://127.0.0.1:${serverPort}/healthz`,
      // Surfaced in CI logs; a silent webServer timeout is undiagnosable otherwise.
      stdout: "pipe",
      stderr: "pipe",
      // An existing process may use the developer's database, not this run's disposable one.
      reuseExistingServer: false,
    },
    {
      command: `npm run dev:e2e -w @racing/client -- --port ${clientPort} --strictPort --host 127.0.0.1`,
      env: {
        VITE_SERVER_PORT: serverPort,
      },
      url: clientUrl,
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
