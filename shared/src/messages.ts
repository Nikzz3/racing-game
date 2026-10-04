import { asDifficulty, type Difficulty } from "./difficulty";
import { asRaceFormat, type RaceFormat, type RacePacer, type RaceState } from "./race";
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

/** A driver's place on one (Track, Difficulty) board, from which Medals and the Rival derive. */
export interface Standing {
  track: TrackSlug;
  difficulty: Difficulty;
  /** The driver's persisted best lap; null before their first Plausible Lap on this board. */
  bestMs: number | null;
  /** The next rung of the Rival ladder; null when no other driver's Replay is faster. */
  rival: { name: string; timeMs: number } | null;
}

/** A recorded car state sample: [t ms since lap start, x, z, rot (rad), speed]. */
export type ReplayFrame = [number, number, number, number, number];

export type ClientMessage =
  | { type: "hello"; name: string; variant?: Variant }
  | { type: "createRoom"; roomName: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "joinRoom"; roomId: string }
  | { type: "leaveRoom" }
  | { type: "respawn" }
  /** Call a race in the sender's Room; ignored while one is already counting down or running. */
  | { type: "startRace"; format: RaceFormat }
  | { type: "getReplay"; name: string; difficulty: Difficulty; track: TrackSlug }
  | { type: "getStandings"; name: string }
  | {
      type: "state";
      x: number;
      y: number;
      z: number;
      rot: number;
      speed: number;
      /** When the pose was current, on the sender's monotonic clock (any epoch); absent from older clients. */
      t?: number;
    };

/** Longest driver name the server keeps; longer names are cut to it. */
export const MAX_NAME_LENGTH = 16;

/** The name a driver races, and their Medals and Standings belong to, under the server's rules. */
export function driverName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || "Racer";
}

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
  startRace: (v) => ({ type: "startRace", format: asRaceFormat(v.format) }),
  getReplay: (v) =>
    isString(v.name)
      ? {
          type: "getReplay",
          name: v.name,
          difficulty: asDifficulty(v.difficulty),
          track: asTrackSlug(v.track),
        }
      : null,
  getStandings: (v) => (isString(v.name) ? { type: "getStandings", name: v.name } : null),
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
  /**
   * The Room's race, sent whenever it changes and on joining mid-race; null once the
   * results screen ends and the Room is back to free driving.
   */
  | { type: "race"; race: RaceState | null }
  /** The grid's Pacers and their laps, sent once per race (and on joining mid-race), before its first `race`. */
  | { type: "racePacers"; pacers: RacePacer[] }
  /**
   * Every board's Standing for one driver name: the answer to getStandings, and
   * sent unprompted to a driver after each of their Plausible Laps is persisted
   * (`afterLap`). A driver receives them in the order they were asked for.
   */
  | { type: "standings"; name: string; standings: Standing[]; afterLap: boolean }
  | { type: "error"; message: string };
