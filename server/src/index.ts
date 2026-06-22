import { createServer } from "node:http";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  asDifficulty,
  type ClientMessage,
  type Difficulty,
  type ServerMessage,
} from "@racing/shared";
import { createPlayer, RoomManager, type Player } from "./rooms";
import { respawnTiming, updateTiming, type LapResult, type SectorBoundary } from "./timing";
import { initDb } from "./db";
import { topEntries, bestTime, loadReferences } from "./leaderboard";
import { backfillSplits, getReplay, makeFrame, submitLap, MAX_REPLAY_FRAMES } from "./replay";

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
  send(player.ws, {
    type: "joined",
    roomId: room.id,
    roomName: room.name,
    difficulty: room.difficulty,
  });
  broadcastRooms();
}

function sectorRefMs(splits: { s1Ms: number; s2Ms: number } | null, sector: 1 | 2): number | null {
  if (!splits) return null;
  return sector === 1 ? splits.s1Ms : splits.s2Ms;
}

function emitSector(player: Player, boundary: SectorBoundary): void {
  const pbRef = sectorRefMs(player.lockedPb, boundary.sector);
  const trRef = sectorRefMs(player.lockedTr, boundary.sector);
  send(player.ws, {
    type: "sector",
    sector: boundary.sector,
    splitMs: boundary.splitMs,
    pbDeltaMs: pbRef === null ? null : boundary.splitMs - pbRef,
    trDeltaMs: trRef === null ? null : boundary.splitMs - trRef,
  });
}

async function handleLapComplete(
  player: Player,
  room: { difficulty: Difficulty; broadcast: (m: ServerMessage) => void },
  lap: LapResult,
  msg: Extract<ClientMessage, { type: "state" }>
): Promise<void> {
  // Lap completed: this sample is both the final frame and frame 0 of the next.
  player.lapFrames.push(makeFrame(lap.lapTimeMs, msg.x, msg.z, msg.rot, msg.speed));
  const frames =
    player.lapFramesValid && player.lapFrames.length >= 2 ? player.lapFrames : null;

  // S3 deltas use the references locked at this lap's start, before they're
  // about to be refreshed by the lapStarted handler below.
  const s3PbDeltaMs =
    player.lockedPb === null ? null : lap.s3SplitMs - player.lockedPb.s3Ms;
  const s3TrDeltaMs =
    player.lockedTr === null ? null : lap.s3SplitMs - player.lockedTr.s3Ms;

  // Track records are per difficulty, so compare against this room's board only.
  const prevRecord = (await bestTime(room.difficulty)) ?? Infinity;
  let isTrackRecord = false;
  const splits = { s1: lap.s1SplitMs, s2: lap.s2SplitMs, s3: lap.s3SplitMs };
  if (await submitLap(player.name, room.difficulty, lap.lapTimeMs, frames, splits)) {
    isTrackRecord = lap.lapTimeMs < prevRecord;
    broadcastAll({ type: "leaderboard", entries: await topEntries(10) });
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
    s3SplitMs: lap.s3SplitMs,
    s3PbDeltaMs,
    s3TrDeltaMs,
  });
}

async function refreshReferences(player: Player, difficulty: Difficulty): Promise<void> {
  const refs = await loadReferences(player.name, difficulty);
  player.lockedPb = refs.pb;
  player.lockedTr = refs.tr;
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
  const update = updateTiming(player.timing, msg.x, msg.z, now);

  if (update.lap) {
    await handleLapComplete(player, room, update.lap, msg);
  } else if (update.sector) {
    // Sector crossings happen mid-lap. The current sample is a regular frame
    // for the lap in progress; record it as usual below.
    emitSector(player, update.sector);
  }

  if (!update.lap) {
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
  }

  if (update.lapStarted) {
    // Snapshot references for the lap that just began. Awaited so subsequent
    // sector crossings (multi-second laps from now) see the fresh values.
    await refreshReferences(player, room.difficulty);
  }
}

async function handleGetReplay(
  player: Player,
  rawName: string,
  difficulty: Difficulty
): Promise<void> {
  const name = rawName.trim().slice(0, 16);
  const replay = name ? await getReplay(name, difficulty) : null;
  if (!replay) {
    send(player.ws, { type: "error", message: `No replay available for ${name || "this driver"}` });
    return;
  }
  send(player.ws, {
    type: "replay",
    name,
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
      const room = manager.create(msg.roomName, asDifficulty(msg.difficulty));
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
      handleGetReplay(player, msg.name, asDifficulty(msg.difficulty)).catch((err) =>
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
  const { filled, unrecoverable } = await backfillSplits();
  if (filled || unrecoverable) {
    console.log(
      `Sector splits backfill: filled ${filled}, unrecoverable ${unrecoverable}`
    );
  }
  await manager.load();
  httpServer.listen(PORT, () => {
    console.log(`Racing server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
