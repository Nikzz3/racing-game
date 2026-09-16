// Build the desktop workspace: compile main.ts, copy the sandboxed preload,
// and bake the server URL into dist/config.json.
//
// Usage: RACING_SERVER_URL=wss://play.example.com npm run build -w desktop
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

// Resolved from typescript's own bin, so no PATH/npx games.
const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const tsc = spawnSync(process.execPath, [tscBin, "-p", path.join(root, "tsconfig.json")], { stdio: "inherit" });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

mkdirSync(dist, { recursive: true });
// The CommonJS preload is excluded from tsconfig and shipped verbatim.
copyFileSync(path.join(root, "src", "preload.cjs"), path.join(dist, "preload.cjs"));

const serverUrl = process.env.RACING_SERVER_URL?.trim() || "ws://localhost:8080";
writeFileSync(path.join(dist, "config.json"), JSON.stringify({ serverUrl }, null, 2) + "\n");

console.log(`desktop: built to ${dist} (serverUrl=${serverUrl})`);
