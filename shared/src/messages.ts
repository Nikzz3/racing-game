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
  /** Stamp of the state this pose came from; absent for clients that predate Direct Links. */
  stamp?: PoseStamp;
  /** The player's client accepts Direct Link signals; absent → relay only. */
  direct?: true;
}

/**
 * Identifies one sent pose so a receiver can merge the copy relayed by the server
 * with the copy sent over a Direct Link. Set by the sending client and passed
 * through unchecked: it only orders poses for rendering, never timing.
 */
export interface PoseStamp {
  /** Increases by one per sent pose. */
  seq: number;
  /** Sender's own clock (ms) when the pose was taken; comparable only between its own poses. */
  sentAt: number;
  /** Sender's respawns so far; a change is a teleport, not movement. */
  epoch: number;
}

/** ICE server a client may use to reach its Room's other drivers; mirrors RTCIceServer. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * WebRTC negotiation payload the server relays between two drivers in the same
 * Room, opaque to it beyond these size-capped shapes.
 */
export type PeerSignal =
  | { kind: "description"; type: "offer" | "answer"; sdp: string }
  | { kind: "candidate"; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

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
  | { type: "hello"; name: string; variant?: Variant; direct?: boolean }
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
      stamp?: PoseStamp;
    }
  | { type: "signal"; to: string; signal: PeerSignal };

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

type Raw = Record<string, unknown>;

const MAX_SDP_LENGTH = 16_384;
const MAX_CANDIDATE_LENGTH = 1024;

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null;
const isShortString = (value: unknown, max: number): value is string =>
  isString(value) && value.length <= max;

/** A malformed stamp is dropped rather than failing the state it rides on. */
function asPoseStamp(value: unknown): PoseStamp | undefined {
  if (!isRaw(value)) return undefined;
  const { seq, sentAt, epoch } = value;
  return isFiniteNumber(seq) && isFiniteNumber(sentAt) && isFiniteNumber(epoch)
    ? { seq, sentAt, epoch }
    : undefined;
}

function asPeerSignal(value: unknown): PeerSignal | null {
  if (!isRaw(value)) return null;
  if (value.kind === "description")
    return (value.type === "offer" || value.type === "answer") &&
      isShortString(value.sdp, MAX_SDP_LENGTH)
      ? { kind: "description", type: value.type, sdp: value.sdp }
      : null;
  if (value.kind === "candidate") {
    const { candidate, sdpMid, sdpMLineIndex } = value;
    return isShortString(candidate, MAX_CANDIDATE_LENGTH) &&
      (sdpMid === null || isShortString(sdpMid, 64)) &&
      (sdpMLineIndex === null || (Number.isInteger(sdpMLineIndex) && Number(sdpMLineIndex) >= 0))
      ? { kind: "candidate", candidate, sdpMid, sdpMLineIndex: sdpMLineIndex as number | null }
      : null;
  }
  return null;
}

// One parser per ClientMessage variant: the mapped type makes adding a variant
// without a parser a compile error, so no valid frame can silently become null.
const PARSERS: {
  [K in ClientMessage["type"]]: (v: Raw) => Extract<ClientMessage, { type: K }> | null;
} = {
  hello: (v) =>
    isString(v.name)
      ? {
          type: "hello",
          name: v.name,
          variant: asVariant(v.variant),
          direct: v.direct === true || undefined,
        }
      : null,
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
          stamp: asPoseStamp(v.stamp),
        }
      : null,
  signal: (v) => {
    const signal = asPeerSignal(v.signal);
    return isShortString(v.to, 64) && signal ? { type: "signal", to: v.to, signal } : null;
  },
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
  | {
      type: "joined";
      roomId: string;
      roomName: string;
      difficulty: Difficulty;
      track: TrackSlug;
      /** ICE servers for Direct Links; absent from servers that predate them. */
      iceServers?: IceServer[];
    }
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
  /** A Direct Link negotiation step from another driver in the same Room. */
  | { type: "signal"; from: string; signal: PeerSignal };
