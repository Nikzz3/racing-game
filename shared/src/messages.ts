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
  /** Respawns so far, advanced together with the spawn position. A change between snapshots is a teleport, not movement. */
  spawns: number;
  /** Cosmetic car choice; absent → clients fall back to hashing the player id. */
  variant?: Variant;
  /**
   * Server time the position was current: the sender's own timestamp mapped
   * onto the server clock, or the state's arrival for a sender without one.
   * Repeats until a newer state arrives. Absent before the player's first
   * state, and from servers predating it; clients then use the snapshot's `t`.
   */
  t?: number;
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
  | {
      type: "state";
      x: number;
      y: number;
      z: number;
      rot: number;
      speed: number;
      /** When the pose was current, on the sender's monotonic clock (any epoch); absent from older clients. */
      t?: number;
    }
  /** Ask Jev for one driving decision about this pose (ADR-0009); `seq` echoes back. */
  | {
      type: "jevDrive";
      seq: number;
      track: TrackSlug;
      x: number;
      z: number;
      heading: number;
      speed: number;
    };

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
      ? {
          type: "state",
          x: v.x,
          y: v.y,
          z: v.z,
          rot: v.rot,
          speed: v.speed,
          ...(isFiniteNumber(v.t) && { t: v.t }),
        }
      : null,
  jevDrive: (v) =>
    isFiniteNumber(v.seq) &&
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.z) &&
    isFiniteNumber(v.heading) &&
    isFiniteNumber(v.speed)
      ? {
          type: "jevDrive",
          seq: v.seq,
          track: asTrackSlug(v.track),
          x: v.x,
          z: v.z,
          heading: v.heading,
          speed: v.speed,
        }
      : null,
};

/**
 * Validate an untrusted, already-JSON-parsed value against the ClientMessage
 * union. A real client can send any shape, so the server must run every
 * inbound frame through this. Difficulty and track are coerced to valid values,
 * an unknown hello variant becomes absent (never a specific car), and state
 * numbers must be finite so NaN/Infinity cannot poison timing. An unusable
 * state timestamp is dropped, leaving the state as an older client's.
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
      /** Whether this server can ask Jev to drive; absent from older servers. */
      jev?: boolean;
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
  | { type: "error"; message: string }
  /** Jev's answer to the `jevDrive` with the same `seq`: probabilities, not a pedal. */
  | { type: "jevDecision"; seq: number; accelerate: number; left: number; latencyMs: number }
  /** The `jevDrive` with this `seq` got no decision; the client keeps its last input. */
  | { type: "jevUnavailable"; seq: number; reason: JevUnavailableReason };

/**
 * `disabled`: no API key (or stub) on this server. `busy`: a decision for this
 * connection is still in flight. `rateLimited`: this connection or the server is
 * over its Jev budget. `failed`: TypeSafe errored or timed out.
 */
export type JevUnavailableReason = "disabled" | "busy" | "rateLimited" | "failed";
