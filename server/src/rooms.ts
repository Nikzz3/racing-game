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
} from "@racing/shared";
import { createTiming, type TimingState } from "./timing";
import { pool } from "./db";

export const ROOM_TTL_MS = 60 * 60 * 1000;

export interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  room: Room | null;
  x: number;
  y: number;
  z: number;
  rot: number;
  speed: number;
  timing: TimingState;
  /** Buffered replay frames for the lap in progress. */
  lapFrames: ReplayFrame[];
  /** False once the recording exceeds the frame cap and must be discarded. */
  lapFramesValid: boolean;
}

export function createPlayer(id: string, ws: WebSocket): Player {
  return {
    id,
    name: "Racer",
    ws,
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
    public readonly id: string,
    public readonly name: string,
    public readonly createdAt: number,
    public readonly difficulty: Difficulty,
    public readonly track: Track
  ) {}

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
    }
  }

  snapshot(): PlayerSnapshot[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      rot: p.rot,
      speed: p.speed,
      laps: p.timing.laps,
      lastLapMs: p.timing.lastLapMs,
      bestLapMs: p.timing.bestLapMs,
      lapStartT: p.timing.lapStartT,
      nextCheckpoint: p.timing.next,
    }));
  }

  expired(now: number): boolean {
    return now - this.createdAt >= ROOM_TTL_MS;
  }

  info(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      difficulty: this.difficulty,
      track: this.track.id,
    };
  }
}

function deleteRow(roomId: string): void {
  pool
    .query("DELETE FROM rooms WHERE id = $1", [roomId])
    .catch((err) => console.error("Failed to delete room row:", err));
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  /** Restore non-expired rooms from the DB and drop expired rows. */
  async load(): Promise<void> {
    await pool.query("DELETE FROM rooms WHERE created_at < now() - $1::interval", [
      `${ROOM_TTL_MS} milliseconds`,
    ]);
    const { rows } = await pool.query(
      "SELECT id, name, created_at, difficulty FROM rooms"
    );
    for (const r of rows) {
      const track = resolveTrack(r.track);
      this.rooms.set(
        r.id,
        new Room(
          r.id,
          r.name,
          new Date(r.created_at).getTime(),
          asDifficulty(r.difficulty),
          track
        )
      );
    }
  }

  create(name: string, difficulty: Difficulty, trackSlug: string = DEFAULT_TRACK_SLUG): Room {
    const track = resolveTrack(trackSlug);
    const id = Math.random().toString(36).slice(2, 9);
    const room = new Room(
      id,
      name.trim().slice(0, 24) || "Race Room",
      Date.now(),
      difficulty,
      track
    );
    this.rooms.set(id, room);
    pool
      .query(
        "INSERT INTO rooms (id, name, created_at, difficulty) VALUES ($1, $2, $3, $4)",
        [room.id, room.name, new Date(room.createdAt), room.difficulty]
      )
      .catch((err) => console.error("Failed to persist room:", err));
    return room;
  }

  /** Joins the room, leaving any current room first. Returns null if the room is gone. */
  join(player: Player, roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    this.leave(player);
    player.timing = createTiming();
    player.lapFrames = [];
    player.lapFramesValid = true;
    room.players.set(player.id, player);
    player.room = room;
    return room;
  }

  leave(player: Player): Room | null {
    const room = player.room;
    if (!room) return null;
    room.players.delete(player.id);
    player.room = null;
    if (room.players.size === 0) {
      this.rooms.delete(room.id);
      deleteRow(room.id);
    }
    return room;
  }

  /** Force-close a room: detach all players and delete it (memory + DB). */
  close(room: Room): Player[] {
    const kicked = [...room.players.values()];
    for (const p of kicked) {
      room.players.delete(p.id);
      p.room = null;
    }
    this.rooms.delete(room.id);
    deleteRow(room.id);
    return kicked;
  }

  list(): RoomInfo[] {
    return [...this.rooms.values()].map((r) => r.info());
  }
}
