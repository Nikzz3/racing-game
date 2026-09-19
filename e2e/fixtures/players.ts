import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { expect, test as base } from "./db";

interface PlayerFixtures {
  playerA: Page;
  playerB: Page;
}

async function usePlayer(
  browser: Browser,
  contextOptions: BrowserContextOptions,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  // Same options as the default context: this worker's baseURL, the small
  // viewport, and reduced motion. Two Rooms render under software WebGL at once,
  // and a slow main thread stalls every locator action and assertion.
  const context = await browser.newContext(contextOptions);
  try {
    await use(await context.newPage());
  } finally {
    await context.close();
  }
}

export const test = base.extend<PlayerFixtures>({
  playerA: async ({ browser, contextOptions }, use) => usePlayer(browser, contextOptions, use),
  playerB: async ({ browser, contextOptions }, use) => usePlayer(browser, contextOptions, use),
});

export { expect };
