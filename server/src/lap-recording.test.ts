import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { resolveTrack, type ClientMessage } from "@racing/shared";
import { recordState } from "./lap-recording";
import { respawnTiming } from "./timing";
import { createPlayer, Room, type Player } from "./rooms";
import { makeFrame, MAX_REPLAY_FRAMES } from "./replay";

vi.mock("./db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

function driver() {
  const player = createPlayer("driver", {} as WebSocket);
  const room = new Room("room", "Race", 0, "medium", resolveTrack("sunset-ridge"));
  player.room = room;
  room.players.set(player.id, player);
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
  return { player, state };
}

describe("respawn publication", () => {
  it("advances the spawn counter together with the first post-respawn position", () => {
    const { player, state } = driver();
    recordState(player, { ...state, x: 100 }, 1_000);
    respawnTiming(player.timing);
    expect(player.timing.spawns).toBe(0);
    expect(player.x).toBe(100);

    recordState(player, state, 1_050);
    expect(player.timing.spawns).toBe(1);
    expect(player.x).toBe(state.x);
    recordState(player, state, 1_100);
    expect(player.timing.spawns).toBe(1);
  });
});

describe("lap recording boundaries", () => {
  it("detaches completed frames and identity before the next position or room change", () => {
    const { player, state } = driver();
    recordState(player, state, 1_000);
    player.timing.next = 0;
    const lap = recordState(player, state, 301_000)!;
    expect(lap.message).toMatchObject({ name: "Ava", laps: 1, lapTimeMs: 300_000 });
    expect(lap.frames?.map((frame) => frame[0])).toEqual([0, 300_000]);
    expect(player.lapFrames?.map((frame) => frame[0])).toEqual([0]);

    recordState(player, state, 301_050);
    player.name = "Changed";
    player.variant = "van";
    player.timing.laps = 9;
    player.room = null;
    expect(player.lapFrames?.map((frame) => frame[0])).toEqual([0, 50]);
    expect(lap.frames?.map((frame) => frame[0])).toEqual([0, 300_000]);
    expect(lap.message.name).toBe("Ava");
    expect(lap.message.laps).toBe(1);
    expect(lap.variant).toBe("taxi");
  });

  it("discards an over-cap replay and starts a fresh recording at the boundary", () => {
    const { player, state } = driver();
    recordState(player, state, 1_000);
    player.lapFrames = Array.from({ length: MAX_REPLAY_FRAMES }, () => makeFrame(0, 0, 0, 0, 0));
    player.timing.next = 0;
    const lap = recordState(player, state, 301_000)!;
    expect(lap.frames).toBeNull();
    expect(player.lapFrames).toHaveLength(1);
  });

  it("stops recording mid-lap once the cap is reached", () => {
    const { player, state } = driver();
    recordState(player, state, 1_000);
    player.lapFrames = Array.from({ length: MAX_REPLAY_FRAMES }, () => makeFrame(0, 0, 0, 0, 0));
    recordState(player, { ...state, x: 100_000 }, 1_050);
    expect(player.lapFrames).toBeNull();
    recordState(player, { ...state, x: 100_000 }, 1_100);
    expect(player.lapFrames).toBeNull();
  });

  it("does not start a recording before crossing the start checkpoint", () => {
    const { player, state } = driver();
    recordState(player, { ...state, x: 100_000 }, 1_000);
    expect(player.lapFrames).toEqual([]);
    expect(player.timing.lapStartT).toBeNull();
  });
});

/** The state time the driver's Room broadcasts. */
function stateTime(player: Player): number | undefined {
  return player.room!.snapshot()[0].t;
}

describe("state time", () => {
  it("is absent until the first state, then stamps an untimed state on arrival", () => {
    const { player, state } = driver();
    expect(stateTime(player)).toBeUndefined();
    recordState(player, state, 1_000);
    expect(stateTime(player)).toBe(1_000);
    recordState(player, state, 1_063);
    expect(stateTime(player)).toBe(1_063);
  });

  it("spaces states by the sender's clock, offset by the least-delayed arrival", () => {
    const { player, state } = driver();
    // The sender's clock reads 100 s behind; transit takes 20 ms plus jitter.
    const stamps = [
      [0, 1_020],
      [50, 1_090],
      [100, 1_120],
      [150, 1_190],
      [200, 1_191],
    ].map(([sent, arrival]) => {
      recordState(player, { ...state, t: sent - 100_000 }, arrival);
      return stateTime(player);
    });
    // The last message is the fastest yet, so it resets the offset.
    expect(stamps).toEqual([1_020, 1_070, 1_120, 1_170, 1_191]);
  });

  it("never runs backwards, ahead of arrival, or more than a second behind it", () => {
    const { player, state } = driver();
    recordState(player, { ...state, t: 5_000 }, 1_000);
    // A clock stepped back cannot rewind the player's timeline.
    recordState(player, { ...state, t: 4_000 }, 1_050);
    expect(stateTime(player)).toBe(1_000);
    // A clock leaping ahead is held to the state's arrival.
    recordState(player, { ...state, t: 9_000 }, 1_100);
    expect(stateTime(player)).toBe(1_100);
    // A clock that paused (a suspended laptop) ages states by a second at most.
    recordState(player, { ...state, t: 9_050 }, 5_000);
    expect(stateTime(player)).toBe(4_000);
  });

  it("leaves lap timing on arrival, whatever the sender claims", () => {
    const { player, state } = driver();
    recordState(player, { ...state, t: 0 }, 1_000);
    player.timing.next = 0;
    const lap = recordState(player, { ...state, t: 1 }, 301_000)!;
    expect(lap.message.lapTimeMs).toBe(300_000);
    expect(player.timing.lapStartT).toBe(301_000);
  });
});
