import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { SUNSET_RIDGE, type ClientMessage, type Standing } from "@racing/shared";
import { RacingApplication } from "./application";
import { standings, topEntries } from "./leaderboard";
import { submitLap } from "./replay";
import { pool } from "./db";
import { LEGACY_RECORD } from "../../tests/fixtures/legacy-replay";

vi.mock("./db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("./leaderboard", () => ({ topEntries: vi.fn(), bestTime: vi.fn(), standings: vi.fn() }));
vi.mock("./replay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replay")>()),
  submitLap: vi.fn(),
}));

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
  vi.mocked(standings).mockReset();
  vi.mocked(submitLap).mockReset().mockResolvedValue(false);
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
});

afterEach(() => vi.restoreAllMocks());

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

async function enter(client: ClientSocket, message: ClientMessage) {
  client.message(message);
  await vi.waitFor(() => expect(client.messages.some((m) => m.type === "joined")).toBe(true));
}

/** Visit every gate of Sunset Ridge and cross the line, `stepMs` apart on the server clock. */
function driveLap(client: ClientSocket, stepMs: number) {
  const clock = vi.spyOn(Date, "now");
  const gates = SUNSET_RIDGE.checkpoints;
  let now = 0;
  for (const gate of [...gates, gates[0]]) {
    clock.mockReturnValue((now += stepMs));
    client.message({ type: "state", x: gate.x, y: 0, z: gate.z, rot: 0, speed: 0 });
  }
}

const DUSK: ClientMessage = {
  type: "createRoom",
  roomName: "Dusk",
  difficulty: "medium",
  track: "sunset-ridge",
};

describe("standings", () => {
  const STANDINGS: Standing[] = [
    {
      track: "sunset-ridge",
      difficulty: "medium",
      bestMs: 60_000,
      rival: { name: "Bolt", timeMs: 55_000 },
    },
  ];

  let application: RacingApplication;
  beforeEach(() => {
    vi.mocked(topEntries).mockResolvedValue([]);
    vi.mocked(standings).mockResolvedValue(STANDINGS);
    application = new RacingApplication();
  });

  async function connected(name: string) {
    const client = new ClientSocket();
    application.connect(client.socket);
    client.message({ type: "hello", name });
    await vi.waitFor(() => expect(client.messages[0]?.type).toBe("welcome"));
    return client;
  }

  it("answers getStandings for the name normalized as hello does", async () => {
    const client = await connected("Ava");
    client.message({ type: "getStandings", name: "  Ava  " });
    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({
        type: "standings",
        name: "Ava",
        standings: STANDINGS,
      }),
    );
    expect(standings).toHaveBeenCalledWith("Ava");
  });

  it("logs a failed lookup without closing the socket", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(standings).mockRejectedValue(new Error("database down"));
    const client = await connected("Ava");
    client.message({ type: "getStandings", name: "Ava" });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("Failed to load standings:", expect.any(Error)),
    );
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(client.messages.map((message) => message.type)).toEqual(["welcome"]);
  });

  it("sends the driver alone their standings after a plausible lap, behind the lap", async () => {
    const driver = await connected("Ava");
    await enter(driver, DUSK);
    const other = await connected("Ben");
    await enter(other, { type: "joinRoom", roomId: application.rooms.list()[0].id });

    driveLap(driver, 5_000);
    await vi.waitFor(() => expect(driver.messages.at(-1)?.type).toBe("standings"));
    expect(submitLap).toHaveBeenCalledOnce();
    expect(driver.messages.at(-2)).toMatchObject({ type: "lap", name: "Ava" });
    expect(driver.messages.at(-1)).toEqual({
      type: "standings",
      name: "Ava",
      standings: STANDINGS,
    });
    expect(other.messages).toContainEqual(expect.objectContaining({ type: "lap", name: "Ava" }));
    expect(other.messages.some((m) => m.type === "standings")).toBe(false);
  });

  it("sends no standings after an implausible lap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const driver = await connected("Ava");
    await enter(driver, DUSK);

    // 100 ms between gates is a teleport at any Difficulty.
    driveLap(driver, 100);
    expect(driver.messages.at(-1)).toMatchObject({ type: "lap", name: "Ava" });
    // Let any persistence job run: every mock resolves within this macrotask.
    await new Promise((resolve) => setImmediate(resolve));
    expect(submitLap).not.toHaveBeenCalled();
    expect(standings).not.toHaveBeenCalled();
  });
});
