import { asDifficulty, type Difficulty } from "./difficulty";
import { asTrackSlug, type TrackSlug } from "./track";

export interface RoomInfo {
  id: string;
  name: string;
  players: number;
  difficulty: Difficulty;
  track: TrackSlug;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  speed: number;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Server timestamp when the current lap started, null if not yet crossed the line. */
  lapStartT: number | null;
  nextCheckpoint: number;
}

export interface LeaderboardEntry {
  name: string;
  timeMs: number;
  date: string;
  hasReplay: boolean;
  difficulty: Difficulty;
  track: TrackSlug;
}

/** A recorded car state sample: [t ms since lap start, x, z, rot (rad), speed]. */
export type ReplayFrame = [number, number, number, number, number];

export type ClientMessage =
  | { type: "hello"; name: string }
  | { type: "createRoom"; roomName: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "joinRoom"; roomId: string }
  | { type: "leaveRoom" }
  | { type: "respawn" }
  | { type: "getReplay"; name: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "state"; x: number; y: number; z: number; rot: number; speed: number };

/**
 * Compile-time guard tying parseClientMessage's cases to the ClientMessage
 * union: this record must have exactly one key per variant `type`. Adding or
 * removing a ClientMessage variant makes this fail to compile, forcing the
 * switch below to be updated instead of silently dropping the new frame type.
 */
const HANDLED_CLIENT_MESSAGE_TYPES: Record<ClientMessage["type"], true> = {
  hello: true,
  createRoom: true,
  joinRoom: true,
  leaveRoom: true,
  respawn: true,
  getReplay: true,
  state: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate an untrusted (already-JSON-parsed) value against the ClientMessage
 * union, returning a normalized message or null. The static ClientMessage type
 * is a compile-time contract only; a real client can send any shape over the
 * wire, so the server MUST run every inbound frame through this before use.
 * Difficulty and track are coerced to valid values; numeric state fields must be
 * finite (rejects NaN/Infinity that would otherwise poison timing/checkpoints).
 */
export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || !isString(value.type)) return null;
  // Reject any type that is not a known ClientMessage variant. Referencing the
  // guard here also keeps it from being dead code the compiler would let rot.
  if (!Object.prototype.hasOwnProperty.call(HANDLED_CLIENT_MESSAGE_TYPES, value.type)) {
    return null;
  }
  switch (value.type) {
    case "hello":
      return isString(value.name) ? { type: "hello", name: value.name } : null;
    case "createRoom":
      return isString(value.roomName)
        ? {
            type: "createRoom",
            roomName: value.roomName,
            difficulty: asDifficulty(value.difficulty),
            track: asTrackSlug(value.track),
          }
        : null;
    case "joinRoom":
      return isString(value.roomId) ? { type: "joinRoom", roomId: value.roomId } : null;
    case "leaveRoom":
      return { type: "leaveRoom" };
    case "respawn":
      return { type: "respawn" };
    case "getReplay":
      return isString(value.name)
        ? {
            type: "getReplay",
            name: value.name,
            difficulty: asDifficulty(value.difficulty),
            track: asTrackSlug(value.track),
          }
        : null;
    case "state":
      return isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.z) &&
        isFiniteNumber(value.rot) &&
        isFiniteNumber(value.speed)
        ? {
            type: "state",
            x: value.x,
            y: value.y,
            z: value.z,
            rot: value.rot,
            speed: value.speed,
          }
        : null;
    default:
      return null;
  }
}

export type ServerMessage =
  | {
      type: "welcome";
      playerId: string;
      rooms: RoomInfo[];
      leaderboard: LeaderboardEntry[];
    }
  | { type: "rooms"; rooms: RoomInfo[] }
  | { type: "joined"; roomId: string; roomName: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "left" }
  | { type: "snapshot"; t: number; players: PlayerSnapshot[] }
  | {
      type: "lap";
      playerId: string;
      name: string;
      lapTimeMs: number;
      bestLapMs: number;
      laps: number;
      isPersonalBest: boolean;
      isTrackRecord: boolean;
    }
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  | { type: "replay"; name: string; track: TrackSlug; timeMs: number; frames: ReplayFrame[] }
  | { type: "error"; message: string };
