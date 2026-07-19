import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  workers: 1,
  // A full injected lap runs under software WebGL; game-seam.ts budgets 240s for it,
  // which the 30s default test timeout would otherwise cut short.
  timeout: 300_000,
  // Each retry re-pays the timeout above, so 2 retries put a single stuck test at
  // 15 minutes. One retry still absorbs a flake without dominating the job.
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run start -w @racing/server",
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        PORT: "8081",
      },
      url: "http://127.0.0.1:8081",
      // Surfaced in CI logs; a silent webServer timeout is undiagnosable otherwise.
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:e2e -w @racing/client -- --port 5174 --host 127.0.0.1",
      env: {
        VITE_SERVER_PORT: "8081",
      },
      url: "http://127.0.0.1:5174",
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
