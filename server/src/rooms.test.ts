import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { pool } from "./db";
import { createPlayer, RoomManager, ROOM_TTL_MS } from "./rooms";

vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

beforeEach(() => {
  vi.mocked(pool.query)
    .mockReset()
    .mockResolvedValue({ rows: [] } as never);
});

describe("room lifecycle", () => {
  it("keeps a room registered when its only driver joins it again", () => {
    const manager = new RoomManager();
    const room = manager.create("Evening race", "hard", "stormhaven");
    const player = createPlayer("driver", {} as WebSocket);
    manager.join(player, room.id);
    manager.join(player, room.id);
    expect(manager.rooms.get(room.id)).toBe(room);
    expect(manager.list()).toEqual([
      {
        id: room.id,
        name: "Evening race",
        players: 1,
        difficulty: "hard",
        track: "stormhaven",
      },
    ]);
    expect(player.room).toBe(room);
  });

  it("waits for room creation before deleting the last driver's room", async () => {
    let finishInsert!: (value: never) => void;
    vi.mocked(pool.query).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInsert = resolve;
        }) as never,
    );
    const manager = new RoomManager();
    const room = manager.create("Race", "medium");
    const player = createPlayer("driver", {} as WebSocket);
    manager.join(player, room.id);
    manager.leave(player);
    await Promise.resolve();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(manager.list()).toEqual([]);
    finishInsert({ rows: [] } as never);
    await vi.waitFor(() => expect(pool.query).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pool.query).mock.calls[1][0]).toContain(
      "DELETE FROM rooms",
    );
  });

  it("expires after one hour and detaches every driver when closed", () => {
    const manager = new RoomManager();
    const room = manager.create("Race", "easy");
    const first = createPlayer("a", {} as WebSocket);
    const second = createPlayer("b", {} as WebSocket);
    manager.join(first, room.id);
    manager.join(second, room.id);
    expect(room.expired(room.createdAt + ROOM_TTL_MS - 1)).toBe(false);
    expect(room.expired(room.createdAt + ROOM_TTL_MS)).toBe(true);
    expect(manager.close(room)).toEqual([first, second]);
    expect(first.room).toBeNull();
    expect(second.room).toBeNull();
    expect(manager.list()).toEqual([]);
  });
});
