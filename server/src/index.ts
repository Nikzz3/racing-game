import "./env";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { RacingApplication } from "./application";
import { initDb } from "./db";
import { createHttpHandler } from "./http";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
const SNAPSHOT_INTERVAL_MS = 50;
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;
/** Each socket is pinged this often and cut off if the previous ping went unanswered. */
const HEARTBEAT_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  await initDb();
  const application = new RacingApplication();
  await application.load();
  const server = createServer(createHttpHandler(CLIENT_DIST));
  const sockets = new WebSocketServer({
    server,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });
  // Sockets that answered the last ping; a silently dead one would keep its car in its Room.
  const alive = new WeakSet<WebSocket>();
  sockets.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    application.connect(socket);
  });
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
  // Browsers answer pings on their own, so a client needs no code for this.
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  server.once("close", () => {
    clearInterval(clock);
    clearInterval(heartbeat);
  });
  console.log(`Racing server listening on http://localhost:${PORT}`);
}

void main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
