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

function join(client: ClientSocket, roomId: string): void {
  client.message({ type: "joinRoom", roomId });
}

function signalsTo(client: ClientSocket): Array<Record<string, unknown>> {
  return client.messages.filter((message) => message.type === "signal");
}

describe("Direct Link signaling", () => {
  const offer = { kind: "description", type: "offer", sdp: "v=0" };

  async function driver(
    application: RacingApplication,
    name: string,
    direct: boolean,
  ): Promise<{ client: ClientSocket; id: string }> {
    const client = new ClientSocket();
    application.connect(client.socket);
    client.message({ type: "hello", name, direct });
    await vi.waitFor(() => expect(client.messages[0]?.type).toBe("welcome"));
    return { client, id: client.messages[0].playerId as string };
  }

  async function room(): Promise<{
    application: RacingApplication;
    roomId: string;
    ava: Awaited<ReturnType<typeof driver>>;
    ben: Awaited<ReturnType<typeof driver>>;
  }> {
    vi.mocked(topEntries).mockResolvedValue([]);
    const application = new RacingApplication([{ urls: "stun:stun.example.test:3478" }]);
    const ava = await driver(application, "Ava", true);
    const ben = await driver(application, "Ben", true);
    ava.client.message({ type: "createRoom", roomName: "Dusk" });
    const roomId = application.rooms.list()[0].id;
    join(ben.client, roomId);
    return { application, roomId, ava, ben };
  }

  it("relays a signal to a Room-mate, stamped with the real sender", async () => {
    const { ava, ben } = await room();
    ava.client.message({ type: "signal", to: ben.id, signal: offer, from: "forged" });
    expect(signalsTo(ben.client)).toEqual([{ type: "signal", from: ava.id, signal: offer }]);
  });

  it("hands the configured ICE servers to each driver joining a Room", async () => {
    const { ben } = await room();
    expect(ben.client.messages).toContainEqual(
      expect.objectContaining({
        type: "joined",
        iceServers: [{ urls: "stun:stun.example.test:3478" }],
      }),
    );
  });

  it("drops signals to drivers outside the sender's Room, to itself, or to unknown ids", async () => {
    const { application, ava, ben } = await room();
    const cleo = await driver(application, "Cleo", true);
    cleo.client.message({ type: "createRoom", roomName: "Dawn" });
    ava.client.message({ type: "signal", to: cleo.id, signal: offer });
    cleo.client.message({ type: "signal", to: ben.id, signal: offer });
    ava.client.message({ type: "signal", to: ava.id, signal: offer });
    ava.client.message({ type: "signal", to: "nobody", signal: offer });
    for (const client of [ava.client, ben.client, cleo.client])
      expect(signalsTo(client)).toEqual([]);
  });

  it("never signals a client that did not offer Direct Links, nor relays from one", async () => {
    const { application, roomId, ava } = await room();
    const old = await driver(application, "Old", false);
    join(old.client, roomId);
    ava.client.message({ type: "signal", to: old.id, signal: offer });
    old.client.message({ type: "signal", to: ava.id, signal: offer });
    expect(signalsTo(old.client)).toEqual([]);
    expect(signalsTo(ava.client)).toEqual([]);
  });

  it("caps how many signals one driver can push through the server", async () => {
    const { ava, ben } = await room();
    for (let index = 0; index < 250; index++)
      ava.client.message({ type: "signal", to: ben.id, signal: offer });
    expect(signalsTo(ben.client)).toHaveLength(200);
  });

  it("relays each driver's pose stamp, with the time it reported, and Direct Link capability", async () => {
    const { application, ava, ben } = await room();
    const stamp = { seq: 3, epoch: 0 };
    ava.client.message({ type: "state", x: 1, y: 0, z: 2, rot: 0, speed: 5, t: 150, stamp });
    // A stamp without the time that places it is useless to receivers.
    ben.client.message({ type: "state", x: 4, y: 0, z: 2, rot: 0, speed: 5, stamp });
    application.tick();
    const snapshot = ava.client.messages.filter(({ type }) => type === "snapshot").at(-1);
    const [avaSeen, benSeen] = snapshot!.players as Array<Record<string, unknown>>;
    expect(avaSeen).toMatchObject({ name: "Ava", stamp: { ...stamp, sentAt: 150 }, direct: true });
    expect(benSeen).toMatchObject({ name: "Ben", x: 4, direct: true });
    expect(benSeen).not.toHaveProperty("stamp");
  });
});
