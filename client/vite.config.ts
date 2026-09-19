import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Repo-root `.env` (see .env.example). Loaded into process.env so PORT/CLIENT_PORT below
// and any VITE_* keys are visible; shell variables take precedence over the file.
const envFile = resolve(import.meta.dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// `npm run dev` in a second checkout (e.g. a git worktree) collides with the default
// ports. CLIENT_PORT moves the Vite dev server; PORT moves the WebSocket server (read
// by server/src/index.ts) and is mirrored into VITE_SERVER_PORT so the client dials it.
// Both are passed to both workspaces by the root `npm run dev`.
process.env.VITE_SERVER_PORT ??= process.env.PORT;
const clientPort = process.env.CLIENT_PORT;

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [".kingfisher-pain.ts.net"],
    ...(clientPort ? { port: Number(clientPort), strictPort: true } : {}),
  },
});
