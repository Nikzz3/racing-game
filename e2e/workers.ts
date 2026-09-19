/**
 * Worker topology for the parallel suite. Every Playwright worker owns a server,
 * a Vite dev server, and a Postgres database, so tests never share rooms or
 * leaderboard rows across workers and the per-test truncation stays safe.
 * playwright.config.ts declares the processes, scripts/test-e2e.ts creates the
 * databases, and the fixtures route each worker by its parallel index.
 */

export const WORKERS = Number(process.env.E2E_WORKERS ?? 2);

const CLIENT_PORT_BASE = Number(process.env.E2E_CLIENT_PORT ?? 5174);
const SERVER_PORT_BASE = Number(process.env.E2E_SERVER_PORT ?? 8081);

export function serverPort(worker: number): number {
  return SERVER_PORT_BASE + worker;
}

export function clientPort(worker: number): number {
  return CLIENT_PORT_BASE + worker;
}

export function clientUrl(worker: number): string {
  return `http://127.0.0.1:${clientPort(worker)}`;
}

export function workerDatabaseName(worker: number): string {
  return `racing_e2e_w${worker}`;
}

/** The base URL's database is the admin connection; workers each get their own. */
export function workerDatabaseUrl(baseUrl: string, worker: number): string {
  const url = new URL(baseUrl);
  url.pathname = `/${workerDatabaseName(worker)}`;
  return url.toString();
}

export function assertWorkerProvisioned(worker: number): void {
  if (worker < WORKERS) return;
  throw new Error(
    `Worker ${worker} has no server or database: the suite provisioned ${WORKERS}. ` +
      "Raise E2E_WORKERS instead of passing --workers to Playwright.",
  );
}
