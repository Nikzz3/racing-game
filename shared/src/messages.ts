import { asDifficulty, type Difficulty } from "./difficulty";
import { asTrackSlug, type TrackSlug } from "./track";
import { asVariant, type Variant } from "./variant";

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
  /** Cosmetic car choice; absent → clients fall back to hashing the player id. */
  variant?: Variant;
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
  | { type: "hello"; name: string; variant?: Variant }
  | { type: "createRoom"; roomName: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "joinRoom"; roomId: string }
  | { type: "leaveRoom" }
  | { type: "respawn" }
  | { type: "getReplay"; name: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "state"; x: number; y: number; z: number; rot: number; speed: number };

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

type Raw = Record<string, unknown>;

// One parser per ClientMessage variant: the mapped type makes adding a variant
// without a parser a compile error, so no valid frame can silently become null.
const PARSERS: {
  [K in ClientMessage["type"]]: (v: Raw) => Extract<ClientMessage, { type: K }> | null;
} = {
  hello: (v) =>
    isString(v.name) ? { type: "hello", name: v.name, variant: asVariant(v.variant) } : null,
  createRoom: (v) =>
    isString(v.roomName)
      ? {
          type: "createRoom",
          roomName: v.roomName,
          difficulty: asDifficulty(v.difficulty),
          track: asTrackSlug(v.track),
        }
      : null,
  joinRoom: (v) => (isString(v.roomId) ? { type: "joinRoom", roomId: v.roomId } : null),
  leaveRoom: () => ({ type: "leaveRoom" }),
  respawn: () => ({ type: "respawn" }),
  getReplay: (v) =>
    isString(v.name)
      ? {
          type: "getReplay",
          name: v.name,
          difficulty: asDifficulty(v.difficulty),
          track: asTrackSlug(v.track),
        }
      : null,
  state: (v) =>
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.y) &&
    isFiniteNumber(v.z) &&
    isFiniteNumber(v.rot) &&
    isFiniteNumber(v.speed)
      ? { type: "state", x: v.x, y: v.y, z: v.z, rot: v.rot, speed: v.speed }
      : null,
};

/**
 * Validate an untrusted, already-JSON-parsed value against the ClientMessage
 * union. A real client can send any shape, so the server must run every
 * inbound frame through this. Difficulty and track are coerced to valid values,
 * an unknown hello variant becomes absent (never a specific car), and state
 * numbers must be finite so NaN/Infinity cannot poison timing.
 */
export function parseClientMessage(value: unknown): ClientMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const type = (value as Raw).type;
  if (!isString(type) || !Object.hasOwn(PARSERS, type)) return null;
  return PARSERS[type as ClientMessage["type"]](value as Raw);
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
  | {
      type: "replay";
      name: string;
      track: TrackSlug;
      timeMs: number;
      frames: ReplayFrame[];
      /** Variant snapshotted when the lap persisted; absent → name-hash fallback. */
      variant?: Variant;
    }
  | { type: "error"; message: string };
