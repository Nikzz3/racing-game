import { createServer } from "node:http";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  asDifficulty,
  asTrackSlug,
  MAX_SPEED_MS,
  minPlausibleLapMs,
  parseClientMessage,
  type ClientMessage,
  type Difficulty,
  type ServerMessage,
} from "@racing/shared";
import { createPlayer, RoomManager, type Player } from "./rooms";
import { respawnTiming, updateTiming } from "./timing";
import { initDb } from "./db";
import { topEntries, bestTime } from "./leaderboard";
import { getReplay, makeFrame, submitLap, MAX_REPLAY_FRAMES } from "./replay";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../client/dist"
);
const SNAPSHOT_INTERVAL_MS = 50;
/** Cap inbound frames well above any legitimate message (~a few KB). */
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

// A single unhandled throw/rejection in a WebSocket listener or a DB callback
// must not take the whole server (and every connected race) down. Log and keep
// serving; individual bad frames are already dropped at the parse boundary.
// Tradeoff: after an uncaughtException the process may be in an undefined state,
// so this is a last-resort net to keep live races alive, not a substitute for
// the deterministic per-frame validation and per-handler try/catch below. Run
// under a supervisor that restarts on crash for defence in depth.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

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
  send(player.ws, {
    type: "joined",
    roomId: room.id,
    roomName: room.name,
    difficulty: room.difficulty,
    track: room.track.id,
  });
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

  const prevStart = player.timing.lapStartT;
  const now = Date.now();
  const maxSpeedMs = MAX_SPEED_MS[room.difficulty];
  const minLapMs = minPlausibleLapMs(room.track, maxSpeedMs);
  const lap = updateTiming(player.timing, msg.x, msg.z, now, room.track.checkpoints, maxSpeedMs, minLapMs);

  if (!lap) {
    // No lap completed: keep recording the lap in progress.
    if (player.timing.lapStartT !== null) {
      if (prevStart === null) {
        // First crossing of the start line this session.
        player.lapFrames = [makeFrame(0, msg.x, msg.z, msg.rot, msg.speed)];
        player.lapFramesValid = true;
      } else if (player.lapFrames.length >= MAX_REPLAY_FRAMES) {
        player.lapFramesValid = false;
      } else {
        player.lapFrames.push(
          makeFrame(now - player.timing.lapStartT, msg.x, msg.z, msg.rot, msg.speed)
        );
      }
    }
    return;
  }

  // Lap completed: this sample is both the final frame and frame 0 of the next.
  player.lapFrames.push(makeFrame(lap.lapTimeMs, msg.x, msg.z, msg.rot, msg.speed));
  const frames =
    player.lapFramesValid && player.lapFrames.length >= 2 ? player.lapFrames : null;

  let isTrackRecord = false;
  if (!lap.isPlausible) {
    console.info(
      `Implausible lap rejected: player=${player.name} track=${room.track.id}` +
      ` difficulty=${room.difficulty} lapTimeMs=${lap.lapTimeMs} minLapMs=${minLapMs}`
    );
  } else {
    // Track records are per (track, difficulty), so compare against this room's board only.
    const prevRecord = (await bestTime(room.track.id, room.difficulty)) ?? Infinity;
    if (await submitLap(player.name, room.track.id, room.difficulty, lap.lapTimeMs, frames)) {
      isTrackRecord = lap.lapTimeMs < prevRecord;
      broadcastAll({ type: "leaderboard", entries: await topEntries(10) });
    }
  }

  // Seed the next lap's buffer with the boundary sample at t = 0.
  player.lapFrames = [makeFrame(0, msg.x, msg.z, msg.rot, msg.speed)];
  player.lapFramesValid = true;

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

async function handleGetReplay(
  player: Player,
  rawName: string,
  track: string,
  difficulty: Difficulty
): Promise<void> {
  const name = rawName.trim().slice(0, 16);
  const replay = name ? await getReplay(name, track, difficulty) : null;
  if (!replay) {
    send(player.ws, { type: "error", message: `No replay available for ${name || "this driver"}` });
    return;
  }
  send(player.ws, {
    type: "replay",
    name,
    track: asTrackSlug(track),
    timeMs: replay.timeMs,
    frames: replay.frames,
  });
}

function handleMessage(player: Player, msg: ClientMessage): void {
  switch (msg.type) {
    case "hello":
      player.name = msg.name.trim().slice(0, 16) || "Racer";
      break;
    case "createRoom": {
      const room = manager.create(
        msg.roomName,
        asDifficulty(msg.difficulty),
        msg.track
      );
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
    case "respawn":
      if (player.room) {
        respawnTiming(player.timing);
        player.lapFrames = [];
        player.lapFramesValid = true;
      }
      break;
    case "state":
      handleState(player, msg).catch((err) =>
        console.error("Failed to handle state:", err)
      );
      break;
    case "getReplay":
      handleGetReplay(player, msg.name, msg.track, asDifficulty(msg.difficulty)).catch((err) =>
        console.error("Failed to handle getReplay:", err)
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

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // The wire type is untrusted: validate the shape before touching any field.
    // A malformed frame is dropped, never allowed to throw out of this listener.
    const msg = parseClientMessage(parsed);
    if (!msg) return;
    try {
      handleMessage(player, msg);
    } catch (err) {
      console.error("Failed to handle message:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
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
