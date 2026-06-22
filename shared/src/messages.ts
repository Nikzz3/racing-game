import type { Difficulty } from "./difficulty";

export interface RoomInfo {
  id: string;
  name: string;
  players: number;
  difficulty: Difficulty;
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
}

/** A recorded car state sample: [t ms since lap start, x, z, rot (rad), speed]. */
export type ReplayFrame = [number, number, number, number, number];

/** Time spent inside each sector of a lap. s1 + s2 + s3 = lap time. */
export interface SectorSplits {
  s1Ms: number;
  s2Ms: number;
  s3Ms: number;
}

export type ClientMessage =
  | { type: "hello"; name: string }
  | { type: "createRoom"; roomName: string; difficulty: Difficulty }
  | { type: "joinRoom"; roomId: string }
  | { type: "leaveRoom" }
  | { type: "respawn" }
  | { type: "getReplay"; name: string; difficulty: Difficulty }
  | { type: "state"; x: number; y: number; z: number; rot: number; speed: number };

export type ServerMessage =
  | {
      type: "welcome";
      playerId: string;
      rooms: RoomInfo[];
      leaderboard: LeaderboardEntry[];
    }
  | { type: "rooms"; rooms: RoomInfo[] }
  | { type: "joined"; roomId: string; roomName: string; difficulty: Difficulty }
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
      /** Time spent in sector 3 (CP8 → CP0). */
      s3SplitMs: number;
      /** s3SplitMs minus the locked PB's S3 split. Null when no PB reference exists for the driver. */
      s3PbDeltaMs: number | null;
      /** s3SplitMs minus the locked TR's S3 split. Null when no TR reference exists or the driver is the TR holder. */
      s3TrDeltaMs: number | null;
    }
  | {
      type: "sector";
      /** 1 = S1 completed at CP4, 2 = S2 completed at CP8. S3 is conveyed via the lap message. */
      sector: 1 | 2;
      splitMs: number;
      pbDeltaMs: number | null;
      trDeltaMs: number | null;
    }
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  | { type: "replay"; name: string; timeMs: number; frames: ReplayFrame[] }
  | { type: "error"; message: string };
