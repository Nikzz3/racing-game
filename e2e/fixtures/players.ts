import type { Browser, Page } from "@playwright/test";
import { expect, test as base } from "./db";

interface PlayerFixtures {
  playerA: Page;
  playerB: Page;
}

async function usePlayer(
  browser: Browser,
  baseURL: string | undefined,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  // Two Rooms render under software WebGL at once; frame cost scales with the
  // canvas, and a slow main thread stalls every locator action and assertion.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 640, height: 480 },
  });
  try {
    await use(await context.newPage());
  } finally {
    await context.close();
  }
}

export const test = base.extend<PlayerFixtures>({
  playerA: async ({ browser, baseURL }, use) => usePlayer(browser, baseURL, use),
  playerB: async ({ browser, baseURL }, use) => usePlayer(browser, baseURL, use),
});

export { expect };
