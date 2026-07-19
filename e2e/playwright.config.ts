import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  workers: 1,
  retries: process.env.CI ? 2 : 0,
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
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -w @racing/client -- --port 5174",
      url: "http://127.0.0.1:5174",
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
