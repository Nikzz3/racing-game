import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { expect, test as base } from "./db";

interface PlayerFixtures {
  playerA: Page;
  playerB: Page;
}

async function usePlayer(
  browser: Browser,
  options: BrowserContextOptions,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext(options);
  try {
    await use(await context.newPage());
  } finally {
    await context.close();
  }
}

export const test = base.extend<PlayerFixtures>({
  // Playwright's `contextOptions` fixture is only the raw `use.contextOptions`
  // value (reduced motion here), so this worker's baseURL and the project
  // viewport are added explicitly. Two Rooms render under software WebGL at
  // once, and a slow main thread stalls every locator action and assertion.
  playerA: async ({ browser, baseURL, contextOptions, viewport }, use) =>
    usePlayer(browser, { ...contextOptions, baseURL, viewport }, use),
  playerB: async ({ browser, baseURL, contextOptions, viewport }, use) =>
    usePlayer(browser, { ...contextOptions, baseURL, viewport }, use),
});

export { expect };
