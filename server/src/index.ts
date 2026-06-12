import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@racing/shared";
import { createPlayer, RoomManager, type Player } from "./rooms";
import { updateTiming } from "./timing";
import { submitTime, topEntries } from "./leaderboard";

const PORT = Number(process.env.PORT ?? 8080);
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

function handleState(
  player: Player,
  msg: Extract<ClientMessage, { type: "state" }>
): void {
  const room = player.room;
  if (!room) return;
  player.x = msg.x;
  player.y = msg.y;
  player.z = msg.z;
  player.rot = msg.rot;
  player.speed = msg.speed;

  const lap = updateTiming(player.timing, msg.x, msg.z, Date.now());
  if (!lap) return;

  const prevRecord = topEntries(1)[0]?.timeMs ?? Infinity;
  let isTrackRecord = false;
  if (submitTime(player.name, lap.lapTimeMs)) {
    isTrackRecord = lap.lapTimeMs < prevRecord;
    broadcastAll({ type: "leaderboard", entries: topEntries(10) });
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
      handleState(player, msg);
      break;
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  const player = createPlayer(Math.random().toString(36).slice(2, 10), ws);
  allPlayers.add(player);
  send(ws, {
    type: "welcome",
    playerId: player.id,
    rooms: manager.list(),
    leaderboard: topEntries(10),
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
  for (const room of manager.rooms.values()) {
    if (room.players.size === 0) continue;
    room.broadcast({ type: "snapshot", t: now, players: room.snapshot() });
  }
}, SNAPSHOT_INTERVAL_MS);

console.log(`Racing server listening on ws://localhost:${PORT}`);
