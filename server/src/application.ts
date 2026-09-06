import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "@racing/shared";
import { bestTime, topEntries } from "./leaderboard";
import { recordState, type CompletedLap } from "./lap-recording";
import { getReplay, submitLap } from "./replay";
import { createPlayer, RoomManager, type Player } from "./rooms";
import { respawnTiming } from "./timing";
import { send, sendEncoded } from "./transport";

export class RacingApplication {
  readonly rooms = new RoomManager();
  private readonly players = new Set<Player>();
  private readonly boardWrites = new Map<string, Promise<void>>();

  async load(): Promise<void> {
    await this.rooms.load();
  }

  connect(socket: WebSocket): void {
    const player = createPlayer(randomUUID().slice(0, 8), socket);
    this.players.add(player);
    const pending: ClientMessage[] = [];
    let ready = false;

    socket.on("message", (raw) => {
      try {
        const message = parseClientMessage(JSON.parse(raw.toString()));
        if (!message) return;
        if (ready) this.receive(player, message);
        else if (pending.length < 128) pending.push(message);
        else socket.close(1008, "Too many messages before welcome");
      } catch (error) {
        if (!(error instanceof SyntaxError))
          console.error("Failed to handle racing message:", error);
      }
    });
    socket.on("error", (error) => console.error("WebSocket error:", error));
    socket.on("close", () => {
      pending.length = 0;
      const room = this.rooms.leave(player);
      this.players.delete(player);
      if (room) this.broadcastRooms();
    });

    void topEntries(10)
      .catch((error) => {
        console.error("Failed to load welcome leaderboard:", error);
        return [];
      })
      .then((leaderboard) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        send(socket, {
          type: "welcome",
          playerId: player.id,
          rooms: this.rooms.list(),
          leaderboard,
        });
        ready = true;
        for (const message of pending.splice(0)) this.receive(player, message);
      })
      .catch((error) => console.error("Failed to initialize driver:", error));
  }

  tick(now = Date.now()): void {
    let changed = false;
    for (const room of this.rooms.rooms.values()) {
      if (room.expired(now)) {
        room.broadcast({ type: "left" });
        this.rooms.close(room);
        changed = true;
      } else if (room.players.size) {
        room.broadcast({ type: "snapshot", t: now, players: room.snapshot() });
      }
    }
    if (changed) this.broadcastRooms();
  }

  private receive(player: Player, message: ClientMessage): void {
    switch (message.type) {
      case "hello":
        player.name = message.name.trim().slice(0, 16) || "Racer";
        player.variant = message.variant;
        return;
      case "createRoom": {
        const room = this.rooms.create(
          message.roomName,
          message.difficulty,
          message.track,
        );
        this.join(player, room.id);
        return;
      }
      case "joinRoom":
        this.join(player, message.roomId);
        return;
      case "leaveRoom":
        this.rooms.leave(player);
        send(player.ws, { type: "left" });
        this.broadcastRooms();
        return;
      case "respawn":
        if (player.room) {
          respawnTiming(player.timing);
          player.lapFrames = [];
          player.lapFramesValid = true;
        }
        return;
      case "state": {
        const lap = recordState(player, message, Date.now());
        if (lap) this.completeLap(lap);
        return;
      }
      case "getReplay":
        void this.replay(player, message).catch((error) => {
          console.error("Failed to load replay:", error);
          send(player.ws, {
            type: "error",
            message: "Replay is temporarily unavailable",
          });
        });
        return;
    }
  }

  private join(player: Player, id: string): void {
    const room = this.rooms.join(player, id);
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
    this.broadcastRooms();
  }

  private async replay(
    player: Player,
    message: Extract<ClientMessage, { type: "getReplay" }>,
  ): Promise<void> {
    const name = message.name.trim().slice(0, 16);
    const replay = name
      ? await getReplay(name, message.track, message.difficulty)
      : null;
    if (!replay) {
      send(player.ws, {
        type: "error",
        message: `No replay available for ${name || "this driver"}`,
      });
      return;
    }
    send(player.ws, { type: "replay", name, track: message.track, ...replay });
  }

  private completeLap(lap: CompletedLap): void {
    if (!lap.plausible) {
      console.info(
        `Implausible lap rejected: player=${lap.message.name} track=${lap.room.track.id}` +
          ` difficulty=${lap.room.difficulty} lapTimeMs=${lap.message.lapTimeMs} minLapMs=${lap.minimumTimeMs}`,
      );
      lap.room.broadcast(lap.message);
      return;
    }

    // Serialize each board's record comparison with its write, while position updates continue.
    const key = `${lap.room.track.id}:${lap.room.difficulty}`;
    const previous = this.boardWrites.get(key) ?? Promise.resolve();
    const pending = previous.then(async () => {
      try {
        const record = await bestTime(lap.room.track.id, lap.room.difficulty);
        const changed = await submitLap(
          lap.message.name,
          lap.room.track.id,
          lap.room.difficulty,
          lap.message.lapTimeMs,
          lap.frames,
          lap.variant,
        );
        if (changed) {
          lap.message.isTrackRecord =
            lap.message.lapTimeMs < (record ?? Infinity);
          this.broadcast({
            type: "leaderboard",
            entries: await topEntries(10),
          });
        }
      } catch (error) {
        console.error("Failed to persist completed lap:", error);
      } finally {
        lap.room.broadcast(lap.message);
      }
    });
    this.boardWrites.set(key, pending);
    void pending.then(() => {
      if (this.boardWrites.get(key) === pending) this.boardWrites.delete(key);
    });
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const player of this.players) sendEncoded(player.ws, data);
  }

  private broadcastRooms(): void {
    this.broadcast({ type: "rooms", rooms: this.rooms.list() });
  }
}
