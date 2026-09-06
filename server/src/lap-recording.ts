import {
  MAX_SPEED_MS,
  minPlausibleLapMs,
  type ClientMessage,
  type ReplayFrame,
  type ServerMessage,
  type Variant,
} from "@racing/shared";
import { makeFrame, MAX_REPLAY_FRAMES } from "./replay";
import type { Player, Room } from "./rooms";
import { updateTiming } from "./timing";

export interface CompletedLap {
  room: Room;
  variant?: Variant;
  frames: ReplayFrame[] | null;
  plausible: boolean;
  minimumTimeMs: number;
  message: Extract<ServerMessage, { type: "lap" }>;
}

/** Capture a position and detach a completed recording before any persistence awaits. */
export function recordState(
  player: Player,
  state: Extract<ClientMessage, { type: "state" }>,
  now: number,
): CompletedLap | null {
  const room = player.room;
  if (!room) return null;
  const { x, y, z, rot, speed } = state;
  Object.assign(player, { x, y, z, rot, speed });

  const previousStart = player.timing.lapStartT;
  const maximumSpeed = MAX_SPEED_MS[room.difficulty];
  const minimumTimeMs = minPlausibleLapMs(room.track, maximumSpeed);
  const lap = updateTiming(
    player.timing,
    x,
    z,
    now,
    room.track.checkpoints,
    maximumSpeed,
    minimumTimeMs,
  );

  if (!lap) {
    if (player.timing.lapStartT === null) return null;
    if (previousStart === null) {
      player.lapFrames = [makeFrame(0, x, z, rot, speed)];
      player.lapFramesValid = true;
    } else if (player.lapFrames.length >= MAX_REPLAY_FRAMES) {
      player.lapFramesValid = false;
    } else if (player.lapFramesValid) {
      player.lapFrames.push(
        makeFrame(now - player.timing.lapStartT, x, z, rot, speed),
      );
    }
    return null;
  }

  const recording = player.lapFrames;
  const valid = player.lapFramesValid && recording.length < MAX_REPLAY_FRAMES;
  if (valid) recording.push(makeFrame(lap.lapTimeMs, x, z, rot, speed));
  player.lapFrames = [makeFrame(0, x, z, rot, speed)];
  player.lapFramesValid = true;

  return {
    room,
    variant: player.variant,
    frames: valid && recording.length >= 2 ? recording : null,
    plausible: lap.isPlausible,
    minimumTimeMs,
    message: {
      type: "lap",
      playerId: player.id,
      name: player.name,
      lapTimeMs: lap.lapTimeMs,
      bestLapMs: player.timing.bestLapMs ?? lap.lapTimeMs,
      laps: player.timing.laps,
      isPersonalBest: lap.isPersonalBest,
      isTrackRecord: false,
    },
  };
}
