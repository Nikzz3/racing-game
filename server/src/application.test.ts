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

async function connect(application: RacingApplication, name: string): Promise<ClientSocket> {
  const client = new ClientSocket();
  application.connect(client.socket);
  client.message({ type: "hello", name });
  await vi.waitFor(() => expect(client.messages[0]?.type).toBe("welcome"));
  return client;
}

/** What a driver was sent besides the lobby's room list and position snapshots. */
const received = (client: ClientSocket) =>
  client.messages.filter(({ type }) => !["welcome", "rooms", "snapshot"].includes(String(type)));

describe("races", () => {
  it("sends the Room the grid's Pacers and then the race, and both to a driver joining mid-race", async () => {
    vi.mocked(topEntries).mockResolvedValue([]);
    vi.mocked(pool.query).mockImplementation(
      async (text) =>
        ({
          rows: text.includes("FROM replays")
            ? [
                {
                  name: "Pace",
                  variant: "taxi",
                  frames: [
                    [0, 0, 0, 0, 0],
                    [60_000, 0, 0, 0, 0],
                  ],
                },
              ]
            : [],
        }) as never,
    );
    const application = new RacingApplication();
    const ava = await connect(application, "Ava");
    const ben = await connect(application, "Ben");
    ava.message({ type: "createRoom", roomName: "Dusk" });
    const roomId = application.rooms.list()[0].id;
    ben.message({ type: "joinRoom", roomId });

    ava.message({ type: "startRace", format: "knockout" });
    await vi.waitFor(() => expect(received(ben).at(-1)?.type).toBe("race"));
    for (const client of [ava, ben]) {
      expect(received(client).slice(-2)).toMatchObject([
        { type: "racePacers", pacers: [{ id: "pacer:1", name: "Pace", variant: "taxi" }] },
        {
          type: "race",
          race: {
            format: "knockout",
            phase: "countdown",
            laps: 2,
            entrants: [{ name: "Ava" }, { name: "Ben" }, { id: "pacer:1", pacer: true }],
          },
        },
      ]);
    }

    const cy = await connect(application, "Cy");
    cy.message({ type: "joinRoom", roomId });
    expect(received(cy).map(({ type }) => type)).toEqual(["joined", "racePacers", "race"]);
  });

  it("calls off a race whose caller left while its Pacers loaded", async () => {
    vi.mocked(topEntries).mockResolvedValue([]);
    let loadPacers!: (value: never) => void;
    vi.mocked(pool.query).mockImplementation(async (text) =>
      text.includes("FROM replays")
        ? new Promise((resolve) => (loadPacers = resolve))
        : ({ rows: [] } as never),
    );
    const application = new RacingApplication();
    const ava = await connect(application, "Ava");
    const ben = await connect(application, "Ben");
    ava.message({ type: "createRoom", roomName: "Dusk" });
    const room = application.rooms.rooms.get(application.rooms.list()[0].id)!;
    ben.message({ type: "joinRoom", roomId: room.id });

    ava.message({ type: "startRace", format: "race" });
    await vi.waitFor(() => expect(loadPacers).toBeDefined());
    ava.message({ type: "leaveRoom" });
    loadPacers({ rows: [] } as never);
    await vi.waitFor(() => expect(room.raceStarting).toBe(false));
    expect(room.race).toBeNull();
  });

  it("refuses a Knockout without a rival, telling the driver who called it", async () => {
    vi.mocked(topEntries).mockResolvedValue([]);
    const application = new RacingApplication();
    const ava = await connect(application, "Ava");
    ava.message({ type: "createRoom", roomName: "Dusk" });
    ava.message({ type: "startRace", format: "knockout" });
    await vi.waitFor(() =>
      expect(received(ava).at(-1)).toEqual({
        type: "error",
        message: "A Knockout needs at least two cars",
      }),
    );
    expect(application.rooms.rooms.get(application.rooms.list()[0].id)?.race).toBeNull();
  });
});
