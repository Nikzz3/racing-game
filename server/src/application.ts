import { randomUUID } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { parseClientMessage, type ClientMessage, type ServerMessage } from "@racing/shared";
import type { JevDriver } from "./jev";
import { JevProxy } from "./jev-proxy";
import { bestTime, topEntries } from "./leaderboard";
import { recordState, type CompletedLap } from "./lap-recording";
import { getReplay, submitLap } from "./replay";
import { createPlayer, RoomManager, type Player } from "./rooms";
import { SerialQueues } from "./serial";
import { respawnTiming } from "./timing";
import { send, sendEncoded } from "./transport";

const MAX_NAME_LENGTH = 16;

/** ws hands text frames over as a Buffer, but its `RawData` type also admits an
 *  ArrayBuffer (whose `toString()` is "[object ArrayBuffer]") and Buffer chunks. */
function rawToString(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  return Buffer.isBuffer(raw) ? raw.toString() : Buffer.from(raw).toString();
}

export class RacingApplication {
  readonly rooms = new RoomManager();
  private readonly players = new Set<Player>();
  // Each (track, difficulty) board compares the record and writes the lap as
  // one job, so two laps finishing together cannot both claim the record.
  private readonly boardWrites = new SerialQueues("Failed to persist completed lap");
  private readonly jev: JevProxy;

  /**
   * `jevDriver` answers Jev Live Runs; null leaves them off (see createJevDriver).
   * `jevDailyDecisions` caps how many decisions a UTC day may ask Jev for.
   */
  constructor(jevDriver: JevDriver | null = null, jevDailyDecisions?: number) {
    this.jev = new JevProxy(jevDriver, jevDailyDecisions);
  }

  async load(): Promise<void> {
    await this.rooms.load();
  }

  connect(socket: WebSocket): void {
    const player = createPlayer(randomUUID().slice(0, 8), socket);
    this.players.add(player);
    // Messages arriving before the welcome is sent are held until then.
    const pending: ClientMessage[] = [];
    let ready = false;

    socket.on("message", (raw) => {
      try {
        const message = parseClientMessage(JSON.parse(rawToString(raw)));
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
      this.jev.disconnect(socket);
      const room = this.rooms.leave(player);
      this.players.delete(player);
      if (room) this.broadcastRooms();
    });

    void topEntries()
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
          jev: this.jev.available,
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
        room.broadcastSnapshot(now);
      }
    }
    if (changed) this.broadcastRooms();
  }

  private receive(player: Player, message: ClientMessage): void {
    switch (message.type) {
      case "hello":
        player.name = message.name.trim().slice(0, MAX_NAME_LENGTH) || "Racer";
        player.variant = message.variant;
        return;
      case "createRoom":
        this.join(
          player,
          this.rooms.create(message.roomName, message.difficulty, message.track).id,
        );
        return;
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
          send(player.ws, { type: "error", message: "Replay is temporarily unavailable" });
        });
        return;
      case "jevDrive":
        this.jev.drive(player.ws, message);
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
    const name = message.name.trim().slice(0, MAX_NAME_LENGTH);
    const replay = name ? await getReplay(name, message.track, message.difficulty) : null;
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
    const { room, message } = lap;
    if (!lap.plausible) {
      console.info(
        `Implausible lap rejected: player=${message.name} track=${room.track.id}` +
          ` difficulty=${room.difficulty} lapTimeMs=${message.lapTimeMs} minLapMs=${room.minLapMs}`,
      );
      room.broadcast(message);
      return;
    }
    // The lap is broadcast only after the record comparison so isTrackRecord
    // is right; position snapshots keep flowing meanwhile.
    void this.boardWrites.enqueue(`${room.track.id}:${room.difficulty}`, async () => {
      try {
        const record = await bestTime(room.track.id, room.difficulty);
        const changed = await submitLap(
          message.name,
          room.track.id,
          room.difficulty,
          message.lapTimeMs,
          lap.frames,
          lap.variant,
        );
        if (changed) {
          message.isTrackRecord = message.lapTimeMs < (record ?? Infinity);
          this.broadcast({ type: "leaderboard", entries: await topEntries() });
        }
      } finally {
        room.broadcast(message);
      }
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
