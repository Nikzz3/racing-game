import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

// Repo-root `.env` (see .env.example) for E2E_* and DOCKER_HOST. Shell variables win, and
// DATABASE_URL is set explicitly for the Playwright process below, so a developer's
// database URL in `.env` never leaks into the suite.
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

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
    // The suite truncates rooms, best_laps, and replays between tests, so an
    // external database must be explicitly marked disposable before we touch it.
    if (process.env.E2E_DATABASE_ALLOW_TRUNCATE !== "1") {
      throw new Error(
        "E2E_DATABASE_URL is set, but the e2e suite erases the rooms, best_laps, and " +
          "replays tables of whatever database it runs against. Set " +
          "E2E_DATABASE_ALLOW_TRUNCATE=1 to confirm that database is disposable.",
      );
    }
    return process.env.E2E_DATABASE_URL;
  }

  adoptPodmanSocket();
  container = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({ POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "postgres", POSTGRES_DB: "racing" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -U postgres -d racing"],
      interval: 1_000,
      timeout: 3_000,
      retries: 30,
    })
    .start();
  // Docker picks a free host port, so a local Postgres (or anything else) on a
  // fixed port can never collide with the throwaway container.
  return `postgres://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/racing`;
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
  exitCode = interrupted ? 1 : await runPlaywright(url);
} finally {
  await stopContainer();
}

process.exitCode = exitCode;
