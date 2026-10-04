import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  CAR_VARIANTS,
  dailyChallenge,
  dailyEndsAt,
  SUNSET_RIDGE,
  type ClientMessage,
  type Standing,
  type Variant,
} from "@racing/shared";
import { RacingApplication } from "./application";
import { dailyBoard, submitDailyLap } from "./daily";
import { standings, topEntries } from "./leaderboard";
import { pool } from "./db";
import { submitLap } from "./replay";
import { LEGACY_RECORD } from "../../tests/fixtures/legacy-replay";

vi.mock("./db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("./leaderboard", () => ({ topEntries: vi.fn(), bestTime: vi.fn(), standings: vi.fn() }));
vi.mock("./daily", () => ({ dailyBoard: vi.fn(), submitDailyLap: vi.fn() }));
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
  vi.mocked(dailyBoard)
    .mockReset()
    .mockImplementation(async (challenge) => ({ challenge, entries: [] }));
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

/** A driver who said hello and asked to join, once the server has put them in a Room. */
async function joinedDriver(
  application: RacingApplication,
  join: Record<string, unknown>,
  name = "Ava",
  variant: Variant = "taxi",
) {
  const client = new ClientSocket();
  application.connect(client.socket);
  client.message({ type: "hello", name, variant });
  client.message(join);
  await vi.waitFor(() =>
    expect(client.messages.some((message) => message.type === "joined")).toBe(true),
  );
  const joined = client.messages.find((message) => message.type === "joined")!;
  const room = application.rooms.rooms.get(joined.roomId as string)!;
  const player = room.players.get(client.messages[0].playerId as string)!;
  return { client, joined, room, player };
}

/**
 * Finish a lap of `lapMs` from the start line, skipping the Checkpoints between.
 * The car never moves, so only the Room's lap-time floor judges plausibility.
 */
function finishLap(
  { client, room, player }: Awaited<ReturnType<typeof joinedDriver>>,
  lapMs: number,
) {
  const start = room.track.checkpoints[0];
  const state = { type: "state", x: start.x, y: 0, z: start.z, rot: 0, speed: 0 };
  client.message(state);
  player.timing.next = 0;
  vi.setSystemTime(Date.now() + lapMs);
  client.message(state);
}

describe("daily challenge", () => {
  const noon = Date.parse("2026-10-05T12:00:00Z");
  const challenge = dailyChallenge(noon);

  beforeEach(() => {
    vi.setSystemTime(noon);
    vi.mocked(topEntries).mockResolvedValue([]);
    vi.mocked(submitLap).mockReset().mockResolvedValue(false);
    vi.mocked(submitDailyLap).mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts every driver who joins the daily in one Room set by the day's challenge", async () => {
    const application = new RacingApplication();
    const ava = await joinedDriver(application, { type: "joinDaily" }, "Ava");
    const ben = await joinedDriver(application, { type: "joinDaily" }, "Ben");

    expect(ava.client.messages[0]).toMatchObject({
      type: "welcome",
      daily: { challenge, entries: [] },
    });
    expect(ava.joined).toEqual({
      type: "joined",
      roomId: ava.room.id,
      roomName: `Daily #${challenge.number}`,
      difficulty: challenge.difficulty,
      track: challenge.track,
      daily: challenge,
    });
    expect(ben.joined).toEqual(ava.joined);
    expect(ben.room).toBe(ava.room);
  });

  it("admits only joinDaily to the Daily Room, which older clients would race in their own car", async () => {
    const application = new RacingApplication();
    const { room } = await joinedDriver(application, { type: "joinDaily" });
    expect(application.rooms.list()).toEqual([]);

    const old = new ClientSocket();
    application.connect(old.socket);
    old.message({ type: "joinRoom", roomId: room.id });
    await vi.waitFor(() =>
      expect(old.messages).toContainEqual({ type: "error", message: "Room no longer exists" }),
    );
    expect(room.players.size).toBe(1);
  });

  it("welcomes drivers with the board as last written, even across a rollover", async () => {
    const persisted = { challenge, entries: [{ name: "Ava", timeMs: 61_000 }] };
    vi.mocked(dailyBoard).mockResolvedValueOnce(persisted);
    const application = new RacingApplication();
    await application.load();
    const early = new ClientSocket();
    application.connect(early.socket);
    await vi.waitFor(() =>
      expect(early.messages).toEqual([expect.objectContaining({ daily: persisted })]),
    );

    let finishWelcome!: (value: []) => void;
    vi.mocked(topEntries).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWelcome = resolve;
        }),
    );
    const late = new ClientSocket();
    application.connect(late.socket);
    // Midnight passes while this welcome still waits on the all-time leaderboard.
    const midnight = dailyEndsAt(challenge);
    application.tick(midnight);
    finishWelcome([]);

    const tomorrow = { challenge: dailyChallenge(midnight), entries: [] };
    await vi.waitFor(() => expect(late.messages).toHaveLength(2));
    expect(late.messages).toEqual([
      { type: "daily", board: tomorrow },
      expect.objectContaining({ type: "welcome", daily: tomorrow }),
    ]);
  });

  it("shows every driver in the Daily Room in the challenge's car", async () => {
    const application = new RacingApplication();
    const own = CAR_VARIANTS.find((variant) => variant !== challenge.variant)!;
    const { client } = await joinedDriver(application, { type: "joinDaily" }, "Ava", own);
    application.tick();
    const snapshot = client.messages.find((message) => message.type === "snapshot");
    expect(snapshot?.players).toEqual([
      expect.objectContaining({ name: "Ava", variant: challenge.variant }),
    ]);
  });

  it("puts a plausible Daily lap on the day's board and shows the board to every driver", async () => {
    const application = new RacingApplication();
    const lobby = new ClientSocket();
    application.connect(lobby.socket);
    const driver = await joinedDriver(application, { type: "joinDaily" }, "Ava");
    const lapMs = driver.room.minLapMs + 1_000;
    const board = { challenge, entries: [{ name: "Ava", timeMs: lapMs }] };
    vi.mocked(dailyBoard).mockResolvedValue(board);

    finishLap(driver, lapMs);

    await vi.waitFor(() => expect(lobby.messages).toContainEqual({ type: "daily", board }));
    expect(submitDailyLap).toHaveBeenCalledWith(challenge.date, "Ava", lapMs);
    // The all-time board takes it too, in the car actually driven.
    expect(submitLap).toHaveBeenCalledWith(
      "Ava",
      challenge.track,
      challenge.difficulty,
      lapMs,
      expect.any(Array),
      challenge.variant,
    );
  });

  it("keeps an implausible Daily lap off the day's board", async () => {
    const application = new RacingApplication();
    const driver = await joinedDriver(application, { type: "joinDaily" });
    finishLap(driver, driver.room.minLapMs - 1);
    await vi.waitFor(() =>
      expect(driver.client.messages).toContainEqual(expect.objectContaining({ type: "lap" })),
    );
    expect(submitDailyLap).not.toHaveBeenCalled();
  });

  it("keeps a lap in an ordinary Room off the daily board", async () => {
    const application = new RacingApplication();
    const driver = await joinedDriver(application, {
      type: "createRoom",
      roomName: "Race",
      difficulty: challenge.difficulty,
      track: challenge.track,
    });
    finishLap(driver, driver.room.minLapMs + 1_000);
    await vi.waitFor(() =>
      expect(driver.client.messages).toContainEqual(expect.objectContaining({ type: "lap" })),
    );
    expect(submitLap).toHaveBeenCalled();
    expect(submitDailyLap).not.toHaveBeenCalled();
  });

  it("closes the Daily Room at UTC midnight and rolls every Lobby over to the next challenge", async () => {
    const application = new RacingApplication();
    const lobby = new ClientSocket();
    application.connect(lobby.socket);
    const driver = await joinedDriver(application, { type: "joinDaily" });
    const midnight = dailyEndsAt(challenge);

    application.tick(midnight - 1);
    expect(driver.player.room).toBe(driver.room);
    expect(lobby.messages.some((message) => message.type === "daily")).toBe(false);

    application.tick(midnight);
    const rollover = { type: "daily", board: { challenge: dailyChallenge(midnight), entries: [] } };
    expect(lobby.messages).toContainEqual(rollover);
    expect(driver.client.messages).toContainEqual(rollover);
    expect(driver.client.messages).toContainEqual({ type: "left" });
    expect(driver.player.room).toBeNull();
    expect(application.rooms.list()).toEqual([]);
  });

  it("keeps a lap finished past midnight on its Room's day, without reviving that board", async () => {
    const application = new RacingApplication();
    const driver = await joinedDriver(application, { type: "joinDaily" });
    const lapMs = driver.room.minLapMs + 1_000;
    const midnight = dailyEndsAt(challenge);
    vi.setSystemTime(midnight + 500 - lapMs);

    finishLap(driver, lapMs);
    // The rollover lands while the lap is still being written.
    application.tick();

    await vi.waitFor(() =>
      expect(submitDailyLap).toHaveBeenCalledWith(challenge.date, "Ava", lapMs),
    );
    // The write reads its board back, but never broadcasts it.
    await vi.waitFor(() => expect(dailyBoard).toHaveBeenCalledTimes(1));
    const boards = driver.client.messages.filter((message) => message.type === "daily");
    expect(boards).toEqual([
      { type: "daily", board: { challenge: dailyChallenge(midnight), entries: [] } },
    ]);
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
        afterLap: false,
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
      afterLap: true,
      standings: STANDINGS,
    });
    expect(other.messages).toContainEqual(expect.objectContaining({ type: "lap", name: "Ava" }));
    expect(other.messages.some((m) => m.type === "standings")).toBe(false);
  });

  it("sends a driver's standings in the order they were asked for", async () => {
    let release!: (value: Standing[]) => void;
    vi.mocked(standings).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const driver = await connected("Ava");
    await enter(driver, DUSK);

    // A slow lookup the Lobby asked for must not land after the newer lap's.
    driver.message({ type: "getStandings", name: "Ava" });
    driveLap(driver, 5_000);
    await vi.waitFor(() => expect(submitLap).toHaveBeenCalledOnce());
    release([]);
    await vi.waitFor(() =>
      expect(driver.messages.filter((m) => m.type === "standings")).toHaveLength(2),
    );
    expect(driver.messages.filter((m) => m.type === "standings").map((m) => m.afterLap)).toEqual([
      false,
      true,
    ]);
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
