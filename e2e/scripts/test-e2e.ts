import { spawn, type ChildProcess } from "node:child_process";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

const POSTGRES_IMAGE = "postgres:17-alpine";
const POSTGRES_CONTAINER_PORT = 5432;
const POSTGRES_CREDENTIALS = {
  user: "postgres",
  password: "postgres",
  database: "racing",
} as const;

let startedPostgresContainer: StartedTestContainer | undefined;
let playwrightProcess: ChildProcess | undefined;
let shutdownSignal: NodeJS.Signals | undefined;
let containerStopPromise: Promise<void> | undefined;

function stopContainer(): Promise<void> {
  if (!startedPostgresContainer) {
    return Promise.resolve();
  }

  containerStopPromise ??= startedPostgresContainer.stop().then(() => undefined);
  return containerStopPromise;
}

async function getDatabaseUrl(): Promise<string> {
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

  startedPostgresContainer = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: POSTGRES_CREDENTIALS.user,
      POSTGRES_PASSWORD: POSTGRES_CREDENTIALS.password,
      POSTGRES_DB: POSTGRES_CREDENTIALS.database,
    })
    .withExposedPorts(POSTGRES_CONTAINER_PORT)
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: [
        "CMD-SHELL",
        `pg_isready -U ${POSTGRES_CREDENTIALS.user} -d ${POSTGRES_CREDENTIALS.database}`,
      ],
      interval: 1_000,
      timeout: 3_000,
      retries: 30,
    })
    .start();

  const { user, password, database } = POSTGRES_CREDENTIALS;
  const host = startedPostgresContainer.getHost();
  // Docker picks a free host port, so a local Postgres (or anything else) on a
  // fixed port can never collide with the throwaway container.
  const hostPort = startedPostgresContainer.getMappedPort(POSTGRES_CONTAINER_PORT);
  return `postgres://${user}:${password}@${host}:${hostPort}/${database}`;
}

function runPlaywright(databaseUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    playwrightProcess = spawn(
      "npx",
      ["playwright", "test", "--config", "e2e/playwright.config.ts", ...process.argv.slice(2)],
      {
        stdio: "inherit",
        // ALLOW_TRUNCATE is safe to grant here: either the wrapper provisioned a
        // throwaway container, or the caller already opted in (checked above).
        env: { ...process.env, DATABASE_URL: databaseUrl, E2E_DATABASE_ALLOW_TRUNCATE: "1" },
      },
    );
    playwrightProcess.once("error", reject);
    playwrightProcess.once("close", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdownSignal = signal;
    playwrightProcess?.kill(signal);
    void stopContainer();
  });
}

let exitCode = 1;
try {
  const databaseUrl = await getDatabaseUrl();
  exitCode = shutdownSignal ? 1 : await runPlaywright(databaseUrl);
} finally {
  await stopContainer();
}

process.exitCode = exitCode;
