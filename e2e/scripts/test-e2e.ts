import { spawn, type ChildProcess } from "node:child_process";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

const POSTGRES_IMAGE = "postgres:17-alpine";
const POSTGRES_CONTAINER_PORT = 5432;
const POSTGRES_HOST_PORT = 5433;
const POSTGRES_CREDENTIALS = {
  user: "postgres",
  password: "postgres",
  database: "racing",
} as const;

let postgresContainer: StartedTestContainer | undefined;
let playwrightProcess: ChildProcess | undefined;
let receivedSignal: NodeJS.Signals | undefined;
let stopPromise: Promise<void> | undefined;

function stopPostgresContainer(): Promise<void> {
  if (!postgresContainer) {
    return Promise.resolve();
  }

  if (!stopPromise) {
    stopPromise = postgresContainer.stop().then(() => undefined);
  }

  return stopPromise;
}

async function resolveDatabaseUrl(): Promise<string> {
  if (process.env.E2E_DATABASE_URL !== undefined) {
    return process.env.E2E_DATABASE_URL;
  }

  postgresContainer = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: POSTGRES_CREDENTIALS.user,
      POSTGRES_PASSWORD: POSTGRES_CREDENTIALS.password,
      POSTGRES_DB: POSTGRES_CREDENTIALS.database,
    })
    .withExposedPorts({ container: POSTGRES_CONTAINER_PORT, host: POSTGRES_HOST_PORT })
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
  return `postgres://${user}:${password}@${postgresContainer.getHost()}:${POSTGRES_HOST_PORT}/${database}`;
}

function runPlaywright(databaseUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    playwrightProcess = spawn(
      "npx",
      ["playwright", "test", "--config", "e2e/playwright.config.ts", ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: databaseUrl },
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
    receivedSignal = signal;
    playwrightProcess?.kill(signal);
    void stopPostgresContainer();
  });
}

let exitCode = 1;
try {
  const databaseUrl = await resolveDatabaseUrl();
  exitCode = receivedSignal ? 1 : await runPlaywright(databaseUrl);
} finally {
  await stopPostgresContainer();
}

process.exitCode = exitCode;
