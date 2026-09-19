import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Client } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { WORKERS, workerDatabaseName } from "../workers";

let container: StartedTestContainer | undefined;
let playwright: ChildProcess | undefined;
let interrupted = false;
let stopping: Promise<unknown> | undefined;

function stopContainer(): Promise<unknown> {
  // Only memoise once a container exists; a signal during startup must not
  // cache a no-op that leaves the container running afterwards.
  if (!container) return Promise.resolve();
  stopping ??= container.stop();
  return stopping;
}

/**
 * Point testcontainers at a rootless Podman socket when Docker is absent, so the suite
 * runs with a bare `npm run test:e2e`. Ryuk, the testcontainers reaper, cannot reap
 * containers under rootless Podman; this script stops its own container in a `finally`
 * block instead. An explicit DOCKER_HOST always wins.
 */
function adoptPodmanSocket(): void {
  if (process.env.DOCKER_HOST !== undefined || existsSync("/var/run/docker.sock")) return;
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}`;
  const socket = `${runtimeDir}/podman/podman.sock`;
  if (!existsSync(socket)) return;
  process.env.DOCKER_HOST = `unix://${socket}`;
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= "true";
}

async function databaseUrl(): Promise<string> {
  if (process.env.E2E_DATABASE_URL !== undefined) {
    // The suite creates racing_e2e_w* databases on that server and truncates
    // rooms, best_laps, and replays in them between tests, so an external server
    // must be explicitly marked disposable before we touch it.
    if (process.env.E2E_DATABASE_ALLOW_TRUNCATE !== "1") {
      throw new Error(
        "E2E_DATABASE_URL is set, but the e2e suite creates racing_e2e_w* databases on " +
          "that Postgres server and erases their rooms, best_laps, and replays tables. " +
          "Set E2E_DATABASE_ALLOW_TRUNCATE=1 to confirm that server is disposable.",
      );
    }
    return process.env.E2E_DATABASE_URL;
  }

  adoptPodmanSocket();
  container = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({ POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "postgres", POSTGRES_DB: "racing" })
    .withExposedPorts(5432)
    // The image's first boot initialises the cluster on a temporary server, stops
    // it, then starts the real one. pg_isready passes against the temporary server
    // too, and a connection made in that window dies with ECONNRESET, so wait for
    // the second "ready to accept connections" line: the real server's.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  // Docker picks a free host port, so a local Postgres (or anything else) on a
  // fixed port can never collide with the throwaway container.
  return `postgres://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/racing`;
}

/**
 * Each worker gets its own database (workers.ts) so the per-test truncation in
 * fixtures/db.ts only ever touches that worker's rows. The base URL is the admin
 * connection; its role needs CREATEDB when it is an external E2E_DATABASE_URL.
 */
async function createWorkerDatabases(adminUrl: string): Promise<void> {
  const admin = await connectWithRetry(adminUrl);
  try {
    for (let worker = 0; worker < WORKERS; worker++) {
      const name = workerDatabaseName(worker);
      const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (existing.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
    }
  } finally {
    await admin.end();
  }
}

/**
 * A Postgres that has just started can still drop the first connection. Without an
 * `error` listener that reset is an uncaught exception, so listen, and retry briefly.
 */
async function connectWithRetry(url: string, attempts = 10): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ connectionString: url });
    client.on("error", (error) => console.error("e2e admin connection error:", error.message));
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

function runPlaywright(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    playwright = spawn(
      "npx",
      ["playwright", "test", "--config", "e2e/playwright.config.ts", ...process.argv.slice(2)],
      {
        stdio: "inherit",
        // ALLOW_TRUNCATE is safe to grant here: either the wrapper provisioned a
        // throwaway container, or the caller already opted in (checked above).
        env: { ...process.env, DATABASE_URL: url, E2E_DATABASE_ALLOW_TRUNCATE: "1" },
      },
    );
    playwright.once("error", reject);
    playwright.once("close", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    interrupted = true;
    playwright?.kill(signal);
    void stopContainer();
  });
}

let exitCode = 1;
try {
  const url = await databaseUrl();
  await createWorkerDatabases(url);
  exitCode = interrupted ? 1 : await runPlaywright(url);
} finally {
  await stopContainer();
}

process.exitCode = exitCode;
