import type { ClientMessage, ReplayFrame, ServerMessage, Variant } from "@racing/shared";
import { makeFrame, MAX_REPLAY_FRAMES } from "./replay";
import type { Player, Room } from "./rooms";
import { settleSpawn, updateTiming } from "./timing";

export interface CompletedLap {
  room: Room;
  variant?: Variant;
  /** Null when the recording was discarded (over the frame cap). */
  frames: ReplayFrame[] | null;
  plausible: boolean;
  message: Extract<ServerMessage, { type: "lap" }>;
}

/** Furthest behind its arrival a state's time may fall, so a paused or wrong sender clock degrades to arrival stamps. */
const MAX_STATE_AGE_MS = 1000;

/**
 * When a reported pose was current, on the server clock, for other clients to
 * interpolate by. The sender's timestamp keeps its states evenly spaced however
 * the network or the snapshot tick bunched them; without one, arrival stands
 * in. Only rendering reads it: lap timing stays on arrival (ADR-0005).
 */
function stateTime(player: Player, sentAt: number | undefined, arrival: number): number {
  let t = arrival;
  if (sentAt !== undefined) {
    player.clock.observe(sentAt, arrival);
    // The offset includes this very message, so t never lands after arrival.
    t = Math.max(sentAt + player.clock.offset!, arrival - MAX_STATE_AGE_MS);
  }
  return Math.max(t, player.stateT ?? t);
}

/**
 * Apply a position report. On lap completion the finished recording and the
 * driver's identity are captured synchronously, before any persistence await,
 * so a later name change, room change or position cannot leak into them.
 */
export function recordState(
  player: Player,
  state: Extract<ClientMessage, { type: "state" }>,
  now: number,
): CompletedLap | null {
  const room = player.room;
  if (!room) return null;
  const { x, y, z, rot, speed } = state;
  player.x = x;
  player.y = y;
  player.z = z;
  player.rot = rot;
  player.speed = speed;
  player.stateT = stateTime(player, state.t, now);
  // Relayed so receivers can merge it with the Direct Link copy of the same pose,
  // and map the sender's clock onto the server's through the reported `t`.
  player.stamp =
    state.stamp && state.t !== undefined ? { ...state.stamp, sentAt: state.t } : undefined;

  const timing = player.timing;
  settleSpawn(timing);
  const wasRunning = timing.lapStartT !== null;
  const lap = updateTiming(
    timing,
    x,
    z,
    now,
    room.track.checkpoints,
    room.maxSpeedMs,
    room.minLapMs,
  );

  if (!lap) {
    if (timing.lapStartT === null) return null;
    if (!wasRunning) player.lapFrames = [makeFrame(0, x, z, rot, speed)];
    else if (player.lapFrames && player.lapFrames.length < MAX_REPLAY_FRAMES) {
      player.lapFrames.push(makeFrame(now - timing.lapStartT, x, z, rot, speed));
    } else player.lapFrames = null;
    return null;
  }

  const recording = player.lapFrames;
  const complete = recording !== null && recording.length < MAX_REPLAY_FRAMES;
  if (complete) recording.push(makeFrame(lap.lapTimeMs, x, z, rot, speed));
  player.lapFrames = [makeFrame(0, x, z, rot, speed)];

  return {
    room,
    variant: player.variant,
    frames: complete && recording.length >= 2 ? recording : null,
    plausible: lap.isPlausible,
    message: {
      type: "lap",
      playerId: player.id,
      name: player.name,
      lapTimeMs: lap.lapTimeMs,
      bestLapMs: timing.bestLapMs ?? lap.lapTimeMs,
      laps: timing.laps,
      isPersonalBest: lap.isPersonalBest,
      isTrackRecord: false,
    },
  };
}
