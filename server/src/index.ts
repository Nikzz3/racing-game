import "./env";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { RacingApplication } from "./application";
import { initDb } from "./db";
import { createHttpHandler } from "./http";
import { createJevDriver } from "./jev";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
const SNAPSHOT_INTERVAL_MS = 50;
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

async function main(): Promise<void> {
  await initDb();
  const jev = createJevDriver();
  const application = new RacingApplication(jev);
  await application.load();
  const server = createServer(createHttpHandler(CLIENT_DIST));
  const sockets = new WebSocketServer({
    server,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });
  sockets.on("connection", (socket) => application.connect(socket));
  sockets.on("error", (error) => console.error("WebSocket server error:", error));

  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(PORT, () => {
      server.off("error", reject);
      resolveReady();
    });
  });
  server.on("error", (error) => console.error("HTTP server error:", error));
  const clock = setInterval(() => {
    try {
      application.tick();
    } catch (error) {
      console.error("Failed to broadcast race snapshot:", error);
    }
  }, SNAPSHOT_INTERVAL_MS);
  server.once("close", () => clearInterval(clock));
  console.log(`Racing server listening on http://localhost:${PORT}`);
  console.log(`Jev Live Runs: ${jev ? jev.kind : "off (no TYPESAFE_API_KEY)"}`);
}

void main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
