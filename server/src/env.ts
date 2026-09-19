// Load the repo-root `.env` before any module reads process.env. Imported first from
// index.ts; ESM evaluates imports in order, so this runs ahead of db.ts. Variables already
// set in the shell win over the file, which keeps CI and the e2e wrapper authoritative.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
