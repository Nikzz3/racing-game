import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { resolveTrack, type ClientMessage } from "@racing/shared";
import { recordState } from "./lap-recording";
import { createPlayer, Room } from "./rooms";
import { makeFrame, MAX_REPLAY_FRAMES } from "./replay";

vi.mock("./db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

function driver() {
  const player = createPlayer("driver", {} as WebSocket);
  const room = new Room(
    "room",
    "Race",
    0,
    "medium",
    resolveTrack("sunset-ridge"),
  );
  player.room = room;
  player.name = "Ava";
  player.variant = "taxi";
  const start = room.track.checkpoints[0];
  const state: Extract<ClientMessage, { type: "state" }> = {
    type: "state",
    x: start.x,
    y: 0,
    z: start.z,
    rot: 0,
    speed: 0,
  };
  return { player, room, state };
}

describe("lap recording boundaries", () => {
  it("detaches completed frames and identity before the next position or room change", () => {
    const { player, state } = driver();
    recordState(player, state, 1_000);
    player.timing.next = 0;
    const lap = recordState(player, state, 301_000)!;
    expect(lap.message).toMatchObject({
      name: "Ava",
      laps: 1,
      lapTimeMs: 300_000,
    });
    expect(lap.frames?.map((frame) => frame[0])).toEqual([0, 300_000]);
    expect(player.lapFrames.map((frame) => frame[0])).toEqual([0]);

    recordState(player, state, 301_050);
    player.name = "Changed";
    player.variant = "van";
    player.timing.laps = 9;
    player.room = null;
    expect(player.lapFrames.map((frame) => frame[0])).toEqual([0, 50]);
    expect(lap.frames?.map((frame) => frame[0])).toEqual([0, 300_000]);
    expect(lap.message.name).toBe("Ava");
    expect(lap.message.laps).toBe(1);
    expect(lap.variant).toBe("taxi");
  });

  it("discards an over-cap replay and starts a fresh recording at the boundary", () => {
    const { player, state } = driver();
    recordState(player, state, 1_000);
    player.lapFrames = Array.from({ length: MAX_REPLAY_FRAMES }, () =>
      makeFrame(0, 0, 0, 0, 0),
    );
    player.timing.next = 0;
    const lap = recordState(player, state, 301_000)!;
    expect(lap.frames).toBeNull();
    expect(player.lapFrames).toHaveLength(1);
    expect(player.lapFramesValid).toBe(true);
  });

  it("does not start a recording before crossing the start checkpoint", () => {
    const { player, state } = driver();
    recordState(player, { ...state, x: 100_000 }, 1_000);
    expect(player.lapFrames).toEqual([]);
    expect(player.timing.lapStartT).toBeNull();
  });
});
