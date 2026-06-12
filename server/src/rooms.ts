import type { WebSocket } from "ws";
import type { PlayerSnapshot, RoomInfo, ServerMessage } from "@racing/shared";
import { createTiming, type TimingState } from "./timing";

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
  };
}

export class Room {
  readonly players = new Map<string, Player>();

  constructor(
    public readonly id: string,
    public readonly name: string
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

  info(): RoomInfo {
    return { id: this.id, name: this.name, players: this.players.size };
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  create(name: string): Room {
    const id = Math.random().toString(36).slice(2, 9);
    const room = new Room(id, name.trim().slice(0, 24) || "Race Room");
    this.rooms.set(id, room);
    return room;
  }

  /** Joins the room, leaving any current room first. Returns null if the room is gone. */
  join(player: Player, roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    this.leave(player);
    player.timing = createTiming();
    room.players.set(player.id, player);
    player.room = room;
    return room;
  }

  leave(player: Player): Room | null {
    const room = player.room;
    if (!room) return null;
    room.players.delete(player.id);
    player.room = null;
    if (room.players.size === 0) this.rooms.delete(room.id);
    return room;
  }

  list(): RoomInfo[] {
    return [...this.rooms.values()].map((r) => r.info());
  }
}
