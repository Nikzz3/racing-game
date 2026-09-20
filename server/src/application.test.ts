import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RacingApplication } from "./application";
import { topEntries } from "./leaderboard";
import { pool } from "./db";
import { LEGACY_RECORD } from "../../tests/fixtures/legacy-replay";

vi.mock("./db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("./leaderboard", () => ({ topEntries: vi.fn(), bestTime: vi.fn() }));

class ClientSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  messages: Array<Record<string, unknown>> = [];
  send(data: string, callback: (error?: Error) => void) {
    this.messages.push(JSON.parse(data));
    callback();
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
  message(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
  get socket() {
    return this as unknown as WebSocket;
  }
}

beforeEach(() => {
  vi.mocked(topEntries).mockReset();
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
});

describe("legacy replay wire compatibility", () => {
  it("accepts requests predating track and difficulty and sends the original frame values", async () => {
    vi.mocked(topEntries).mockResolvedValue([]);
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          time_ms: LEGACY_RECORD.time_ms,
          frames: LEGACY_RECORD.frames,
          variant: null,
        },
      ],
    } as never);
    const application = new RacingApplication();
    const client = new ClientSocket();
    application.connect(client.socket);
    client.message({ type: "getReplay", name: LEGACY_RECORD.name });
    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({
        type: "replay",
        name: LEGACY_RECORD.name,
        track: "sunset-ridge",
        timeMs: LEGACY_RECORD.time_ms,
        frames: LEGACY_RECORD.frames,
      }),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      LEGACY_RECORD.name,
      "sunset-ridge",
      "medium",
    ]);
  });

  it("preserves explicit scope and the car recorded by the previous version", async () => {
    vi.mocked(topEntries).mockResolvedValue([]);
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          time_ms: LEGACY_RECORD.time_ms,
          frames: LEGACY_RECORD.frames,
          variant: "taxi",
        },
      ],
    } as never);
    const application = new RacingApplication();
    const client = new ClientSocket();
    application.connect(client.socket);
    client.message({
      type: "hello",
      name: LEGACY_RECORD.name,
      variant: "police",
    });
    client.message({
      type: "getReplay",
      name: LEGACY_RECORD.name,
      track: "stormhaven",
      difficulty: "hard",
    });
    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({
        type: "replay",
        name: LEGACY_RECORD.name,
        track: "stormhaven",
        timeMs: LEGACY_RECORD.time_ms,
        frames: LEGACY_RECORD.frames,
        variant: "taxi",
      }),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      LEGACY_RECORD.name,
      "stormhaven",
      "hard",
    ]);
  });
});

describe("connection initialization", () => {
  it("accepts early identity and room messages after delivering welcome", async () => {
    let finishWelcome!: (value: []) => void;
    vi.mocked(topEntries).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishWelcome = resolve;
        }),
    );
    const application = new RacingApplication();
    const client = new ClientSocket();
    application.connect(client.socket);
    client.message({ type: "hello", name: "Ava", variant: "taxi" });
    client.message({
      type: "createRoom",
      roomName: "Dusk",
      difficulty: "easy",
      track: "sunset-ridge",
    });
    expect(client.messages).toEqual([]);
    finishWelcome([]);
    await vi.waitFor(() =>
      expect(client.messages.some((message) => message.type === "joined")).toBe(true),
    );
    expect(client.messages[0].type).toBe("welcome");
    application.tick();
    const snapshot = client.messages.find((message) => message.type === "snapshot");
    expect(snapshot?.players).toEqual([expect.objectContaining({ name: "Ava", variant: "taxi" })]);
  });

  it("drops queued work if a driver disconnects during the database query", async () => {
    let finishWelcome!: (value: []) => void;
    vi.mocked(topEntries).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishWelcome = resolve;
        }),
    );
    const application = new RacingApplication();
    const client = new ClientSocket();
    application.connect(client.socket);
    client.message({ type: "createRoom", roomName: "Dusk" });
    client.close();
    finishWelcome([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(application.rooms.list()).toEqual([]);
    expect(client.messages).toEqual([]);
  });
});
