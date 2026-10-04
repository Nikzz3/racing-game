import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  asDifficulty,
  ClockOffset,
  dailyEndsAt,
  MAX_SPEED_MS,
  minPlausibleLapMs,
  resolveTrack,
  type DailyChallenge,
  type Difficulty,
  type PlayerSnapshot,
  type RaceFormat,
  type ReplayFrame,
  type RoomInfo,
  type ServerMessage,
  type Track,
  type Variant,
} from "@racing/shared";
import { pool } from "./db";
import { gridPacers, Race, type PacerReplay } from "./race";
import { SerialQueues } from "./serial";
import { createTiming, gridTiming, type TimingState } from "./timing";
import { send, sendEncoded, sendLatest } from "./transport";

export const ROOM_TTL_MS = 60 * 60 * 1000;

const NO_RACE = JSON.stringify({ type: "race", race: null } satisfies ServerMessage);

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
  /** Server time the stored position was current; null before the first state. */
  stateT: number | null;
  /** Relates the driver's state timestamps to the server clock. */
  clock: ClockOffset;
  timing: TimingState;
  /** Frames of the lap in progress; null once the lap outgrew MAX_REPLAY_FRAMES. */
  lapFrames: ReplayFrame[] | null;
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
    stateT: null,
    clock: new ClockOffset(),
    timing: createTiming(),
    lapFrames: [],
  };
}

export class Room {
  readonly players = new Map<string, Player>();
  readonly maxSpeedMs: number;
  readonly minLapMs: number;
  /** The race called in this Room, from the call until its results have shown. */
  race: Race | null = null;
  /** A race call is loading its Pacers; further calls are ignored until it is in. */
  raceStarting = false;
  /** The `race` message last broadcast, also sent to drivers joining mid-race. */
  private raceData = NO_RACE;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly createdAt: number,
    readonly difficulty: Difficulty,
    readonly track: Track,
    /** Set on a Daily Room, whose challenge forces its Variant and ends its day. */
    readonly daily?: DailyChallenge,
  ) {
    this.maxSpeedMs = MAX_SPEED_MS[difficulty];
    this.minLapMs = minPlausibleLapMs(track, this.maxSpeedMs);
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

  expired(now: number): boolean {
    return now >= (this.daily ? dailyEndsAt(this.daily) : this.createdAt + ROOM_TTL_MS);
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const player of this.players.values()) sendEncoded(player.ws, data);
  }

  /** Positions are superseded every tick, so a backlogged driver skips them. */
  broadcastSnapshot(now: number): void {
    const message: ServerMessage = { type: "snapshot", t: now, players: this.snapshot() };
    const data = JSON.stringify(message);
    for (const player of this.players.values()) sendLatest(player.ws, data);
  }

  /** A race may be called when none is counting down or running and no call is loading. */
  canStartRace(): boolean {
    return !this.raceStarting && (this.race === null || this.race.phase === "results");
  }

  /**
   * Call a race: every driver in the Room takes a grid slot and is sent back to
   * it, Pacers from `replays` fill the empty slots, and the Room is sent the
   * Pacers, then the race. Returns false, starting nothing, when a Knockout
   * would have fewer than two cars.
   */
  startRace(format: RaceFormat, replays: PacerReplay[], now: number): boolean {
    const drivers = [...this.players.values()];
    const pacers = gridPacers(
      drivers.map((driver) => driver.name),
      replays,
    );
    if (format === "knockout" && drivers.length + pacers.length < 2) return false;
    for (const driver of drivers) {
      gridTiming(driver.timing);
      driver.lapFrames = [];
    }
    this.race = new Race(format, this.track, drivers, pacers, now);
    this.broadcast({ type: "racePacers", pacers });
    this.updateRace(now);
    return true;
  }

  /** Advance the race, broadcasting its state when it changed; null once its results have shown. */
  updateRace(now: number): void {
    if (!this.race) return;
    const race = this.race.tick(now);
    if (!race) this.race = null;
    const data = JSON.stringify({ type: "race", race } satisfies ServerMessage);
    if (data === this.raceData) return;
    this.raceData = data;
    for (const player of this.players.values()) sendEncoded(player.ws, data);
  }

  /** Bring a driver joining mid-race up to date: the grid's Pacers, then the race. */
  sendRace(player: Player): void {
    if (!this.race) return;
    send(player.ws, { type: "racePacers", pacers: this.race.pacers });
    sendEncoded(player.ws, this.raceData);
  }

  snapshot(): PlayerSnapshot[] {
    return Array.from(this.players.values(), (player) => ({
      id: player.id,
      name: player.name,
      variant: this.daily?.variant ?? player.variant,
      x: player.x,
      y: player.y,
      z: player.z,
      rot: player.rot,
      speed: player.speed,
      laps: player.timing.laps,
      lastLapMs: player.timing.lastLapMs,
      bestLapMs: player.timing.bestLapMs,
      lapStartT: player.timing.lapStartT,
      lapPenaltyMs: player.timing.penaltyMs,
      missedCheckpoints: player.timing.missedCheckpoints,
      nextCheckpoint: player.timing.next,
      spawns: player.timing.spawns,
      t: player.stateT ?? undefined,
    }));
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  // Per-room write order matters: the insert must finish before a fast
  // departure's delete, or a restart would restore an empty room.
  private readonly writes = new SerialQueues("Failed to persist room");

  async load(): Promise<void> {
    await pool.query("DELETE FROM rooms WHERE created_at <= now() - $1::interval", [
      `${ROOM_TTL_MS} milliseconds`,
    ]);
    const { rows } = await pool.query("SELECT id, name, created_at, difficulty, track FROM rooms");
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

  create(name: string, difficulty: Difficulty, trackSlug?: string): Room {
    const room = new Room(
      randomUUID().slice(0, 8),
      name.trim().slice(0, 24) || "Race Room",
      Date.now(),
      difficulty,
      resolveTrack(trackSlug),
    );
    this.rooms.set(room.id, room);
    void this.writes.enqueue(room.id, () =>
      pool.query(
        "INSERT INTO rooms (id, name, created_at, difficulty, track) VALUES ($1, $2, $3, $4, $5)",
        [room.id, room.name, new Date(room.createdAt), room.difficulty, room.track.id],
      ),
    );
    return room;
  }

  /**
   * The challenge's Daily Room, created on first join. It is never persisted:
   * load() would restore it as an ordinary one-hour Room.
   */
  dailyRoom(challenge: DailyChallenge): Room {
    const id = `daily-${challenge.date}`;
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(
        id,
        `Daily #${challenge.number}`,
        Date.now(),
        challenge.difficulty,
        resolveTrack(challenge.track),
        challenge,
      );
      this.rooms.set(id, room);
    }
    return room;
  }

  join(player: Player, roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (player.room !== room) this.leave(player);
    player.timing = createTiming();
    player.lapFrames = [];
    player.room = room;
    room.players.set(player.id, player);
    return room;
  }

  leave(player: Player): Room | null {
    const room = player.room;
    if (!room) return null;
    room.players.delete(player.id);
    // Leaving mid-race, for another Room or for good, is a DNF.
    room.race?.leave(player.id, Date.now());
    player.room = null;
    player.lapFrames = [];
    if (room.players.size === 0) this.remove(room);
    return room;
  }

  close(room: Room): void {
    for (const player of room.players.values()) {
      player.room = null;
      player.lapFrames = [];
    }
    room.players.clear();
    this.remove(room);
  }

  /** Ordinary Rooms only: the Daily Room is entered from its Lobby banner. */
  list(): RoomInfo[] {
    return Array.from(this.rooms.values())
      .filter((room) => !room.daily)
      .map((room) => room.info());
  }

  private remove(room: Room): void {
    this.rooms.delete(room.id);
    if (room.daily) return; // never persisted, so no row to delete
    void this.writes.enqueue(room.id, () =>
      pool.query("DELETE FROM rooms WHERE id = $1", [room.id]),
    );
  }
}
