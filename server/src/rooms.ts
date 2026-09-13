import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  asDifficulty,
  DEFAULT_TRACK_SLUG,
  resolveTrack,
  type Difficulty,
  type PlayerSnapshot,
  type ReplayFrame,
  type RoomInfo,
  type ServerMessage,
  type Track,
  type Variant,
} from "@racing/shared";
import { pool } from "./db";
import { createTiming, type TimingState } from "./timing";
import { sendEncoded } from "./transport";

export const ROOM_TTL_MS = 60 * 60 * 1000;

export interface Player {
  id: string;
  name: string;
  variant?: Variant;
  ws: WebSocket;
  room: Room | null;
  x: number;
  y: number;
  z: number;
  rot: number;
  speed: number;
  timing: TimingState;
  lapFrames: ReplayFrame[];
  lapFramesValid: boolean;
}

export function createPlayer(id: string, ws: WebSocket): Player {
  return {
    id,
    ws,
    name: "Racer",
    room: null,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    speed: 0,
    timing: createTiming(),
    lapFrames: [],
    lapFramesValid: true,
  };
}

export class Room {
  readonly players = new Map<string, Player>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly createdAt: number,
    readonly difficulty: Difficulty,
    readonly track: Track,
  ) {}

  info(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      difficulty: this.difficulty,
      track: this.track.id,
    };
  }

  expired(now: number): boolean {
    return now >= this.createdAt + ROOM_TTL_MS;
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const player of this.players.values()) sendEncoded(player.ws, data);
  }

  snapshot(): PlayerSnapshot[] {
    return Array.from(this.players.values(), (player) => ({
      id: player.id,
      name: player.name,
      variant: player.variant,
      x: player.x,
      y: player.y,
      z: player.z,
      rot: player.rot,
      speed: player.speed,
      laps: player.timing.laps,
      lastLapMs: player.timing.lastLapMs,
      bestLapMs: player.timing.bestLapMs,
      lapStartT: player.timing.lapStartT,
      nextCheckpoint: player.timing.next,
    }));
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly pendingWrites = new Map<string, Promise<void>>();

  async load(): Promise<void> {
    await pool.query(
      "DELETE FROM rooms WHERE created_at <= now() - $1::interval",
      [`${ROOM_TTL_MS} milliseconds`],
    );
    const { rows } = await pool.query(
      "SELECT id, name, created_at, difficulty, track FROM rooms",
    );
    for (const row of rows) {
      const room = new Room(
        row.id,
        row.name,
        new Date(row.created_at).getTime(),
        asDifficulty(row.difficulty),
        resolveTrack(row.track),
      );
      this.rooms.set(room.id, room);
    }
  }

  create(
    name: string,
    difficulty: Difficulty,
    trackSlug: string = DEFAULT_TRACK_SLUG,
  ): Room {
    const room = new Room(
      randomUUID().slice(0, 8),
      name.trim().slice(0, 24) || "Race Room",
      Date.now(),
      difficulty,
      resolveTrack(trackSlug),
    );
    this.rooms.set(room.id, room);
    this.persist(room.id, () =>
      pool.query(
        "INSERT INTO rooms (id, name, created_at, difficulty, track) VALUES ($1, $2, $3, $4, $5)",
        [
          room.id,
          room.name,
          new Date(room.createdAt),
          room.difficulty,
          room.track.id,
        ],
      ),
    );
    return room;
  }

  join(player: Player, roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (player.room !== room) this.leave(player);
    player.timing = createTiming();
    player.lapFrames = [];
    player.lapFramesValid = true;
    player.room = room;
    room.players.set(player.id, player);
    return room;
  }

  leave(player: Player): Room | null {
    const room = player.room;
    if (!room) return null;
    room.players.delete(player.id);
    player.room = null;
    player.lapFrames = [];
    player.lapFramesValid = true;
    if (room.players.size === 0) this.remove(room);
    return room;
  }

  close(room: Room): Player[] {
    const players = [...room.players.values()];
    for (const player of players) {
      player.room = null;
      player.lapFrames = [];
      player.lapFramesValid = true;
    }
    room.players.clear();
    this.remove(room);
    return players;
  }

  list(): RoomInfo[] {
    return Array.from(this.rooms.values(), (room) => room.info());
  }

  private remove(room: Room): void {
    this.rooms.delete(room.id);
    this.persist(room.id, () =>
      pool.query("DELETE FROM rooms WHERE id = $1", [room.id]),
    );
  }

  /** Finish inserts before deletes so a fast departure cannot leave a restored empty room. */
  private persist(roomId: string, write: () => Promise<unknown>): void {
    const previous = this.pendingWrites.get(roomId) ?? Promise.resolve();
    const pending = previous.then(write).then(
      () => {},
      (error) => {
        console.error("Failed to persist room:", error);
      },
    );
    this.pendingWrites.set(roomId, pending);
    void pending.then(() => {
      if (this.pendingWrites.get(roomId) === pending)
        this.pendingWrites.delete(roomId);
    });
  }
}
