import { createServer } from "node:http";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@racing/shared";
import { createPlayer, RoomManager, type Player } from "./rooms";
import { updateTiming } from "./timing";
import { initDb } from "./db";
import { submitTime, topEntries } from "./leaderboard";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../client/dist"
);
const SNAPSHOT_INTERVAL_MS = 50;

const manager = new RoomManager();
const allPlayers = new Set<Player>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastAll(msg: ServerMessage): void {
  for (const p of allPlayers) send(p.ws, msg);
}

function broadcastRooms(): void {
  broadcastAll({ type: "rooms", rooms: manager.list() });
}

function joinRoom(player: Player, roomId: string): void {
  const room = manager.join(player, roomId);
  if (!room) {
    send(player.ws, { type: "error", message: "Room no longer exists" });
    return;
  }
  send(player.ws, { type: "joined", roomId: room.id, roomName: room.name });
  broadcastRooms();
}

async function handleState(
  player: Player,
  msg: Extract<ClientMessage, { type: "state" }>
): Promise<void> {
  const room = player.room;
  if (!room) return;
  player.x = msg.x;
  player.y = msg.y;
  player.z = msg.z;
  player.rot = msg.rot;
  player.speed = msg.speed;

  const lap = updateTiming(player.timing, msg.x, msg.z, Date.now());
  if (!lap) return;

  const prevRecord = (await topEntries(1))[0]?.timeMs ?? Infinity;
  let isTrackRecord = false;
  if (await submitTime(player.name, lap.lapTimeMs)) {
    isTrackRecord = lap.lapTimeMs < prevRecord;
    broadcastAll({ type: "leaderboard", entries: await topEntries(10) });
  }
  room.broadcast({
    type: "lap",
    playerId: player.id,
    name: player.name,
    lapTimeMs: lap.lapTimeMs,
    bestLapMs: player.timing.bestLapMs ?? lap.lapTimeMs,
    laps: player.timing.laps,
    isPersonalBest: lap.isPersonalBest,
    isTrackRecord,
  });
}

function handleMessage(player: Player, msg: ClientMessage): void {
  switch (msg.type) {
    case "hello":
      player.name = msg.name.trim().slice(0, 16) || "Racer";
      break;
    case "createRoom": {
      const room = manager.create(msg.roomName);
      joinRoom(player, room.id);
      break;
    }
    case "joinRoom":
      joinRoom(player, msg.roomId);
      break;
    case "leaveRoom":
      manager.leave(player);
      send(player.ws, { type: "left" });
      broadcastRooms();
      break;
    case "state":
      handleState(player, msg).catch((err) =>
        console.error("Failed to handle state:", err)
      );
      break;
  }
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const httpServer = createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0];
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(CLIENT_DIST, safePath);
  if (!filePath.startsWith(CLIENT_DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(CLIENT_DIST, "index.html");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", async (ws) => {
  const player = createPlayer(Math.random().toString(36).slice(2, 10), ws);
  allPlayers.add(player);
  send(ws, {
    type: "welcome",
    playerId: player.id,
    rooms: manager.list(),
    leaderboard: await topEntries(10).catch(() => []),
  });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(player, msg);
  });

  ws.on("close", () => {
    const left = manager.leave(player);
    allPlayers.delete(player);
    if (left) broadcastRooms();
  });
});

setInterval(() => {
  const now = Date.now();
  let roomsChanged = false;
  for (const room of manager.rooms.values()) {
    if (room.expired(now)) {
      room.broadcast({ type: "left" });
      manager.close(room);
      roomsChanged = true;
      continue;
    }
    if (room.players.size === 0) continue;
    room.broadcast({ type: "snapshot", t: now, players: room.snapshot() });
  }
  if (roomsChanged) broadcastRooms();
}, SNAPSHOT_INTERVAL_MS);

async function main(): Promise<void> {
  await initDb();
  await manager.load();
  httpServer.listen(PORT, () => {
    console.log(`Racing server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
