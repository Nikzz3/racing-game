// Load the repo-root `.env` (see .env.example) for E2E_* and DOCKER_HOST. Imported first
// from test-e2e.ts: ESM evaluates imports in order, so this runs before ../workers reads
// E2E_WORKERS. Shell variables win, and DATABASE_URL is passed explicitly to Playwright,
// so a developer's database URL in `.env` never leaks into the suite.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
