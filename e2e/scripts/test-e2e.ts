import { spawn, type ChildProcess } from "node:child_process";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

const POSTGRES_PORT = 5433;
let container: StartedTestContainer | undefined;
let playwright: ChildProcess | undefined;
let receivedSignal: NodeJS.Signals | undefined;
let stopPromise: Promise<void> | undefined;

function stopContainer(): Promise<void> {
  if (!container) return Promise.resolve();
  stopPromise ??= container.stop().then(() => undefined);
  return stopPromise;
}

async function databaseUrl(): Promise<string> {
  if (process.env.E2E_DATABASE_URL !== undefined) {
    return process.env.E2E_DATABASE_URL;
  }

  container = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "racing",
    })
    .withExposedPorts({ container: 5432, host: POSTGRES_PORT })
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -U postgres -d racing"],
      interval: 1_000,
      timeout: 3_000,
      retries: 30,
    })
    .start();

  return `postgres://postgres:postgres@${container.getHost()}:${POSTGRES_PORT}/racing`;
}

function runPlaywright(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    playwright = spawn(
      "npx",
      ["playwright", "test", "--config", "e2e/playwright.config.ts", ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: url },
      },
    );
    playwright.once("error", reject);
    playwright.once("close", (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    receivedSignal = signal;
    playwright?.kill(signal);
    void stopContainer();
  });
}

let exitCode = 1;
try {
  const url = await databaseUrl();
  exitCode = receivedSignal ? 1 : await runPlaywright(url);
} finally {
  await stopContainer();
}
process.exitCode = exitCode;
