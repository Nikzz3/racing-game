import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { SUNSET_RIDGE } from "@racing/shared";
import { RacingApplication } from "./application";
import type { JevAnswer, JevDriver, JevRequestOptions } from "./jev";
import {
  JEV_BURST,
  JEV_DEFAULT_DAILY_DECISIONS,
  JEV_MAX_IN_FLIGHT,
  JEV_RATE_PER_SECOND,
  JEV_SERVER_RATE_PER_SECOND,
  JEV_TIMEOUT_MS,
  jevDailyDecisions,
} from "./jev-proxy";
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

const ANSWER: JevAnswer = {
  accelerate: 0.8,
  left: 0.3,
  pedalConfidence: 0.6,
  steerConfidence: 0.4,
  latencyMs: 240,
  model: "jev-1.13.0",
};
const sample = SUNSET_RIDGE.samples[500];
const POSE = {
  x: sample.x,
  z: sample.z,
  heading: Math.atan2(sample.dirX, sample.dirZ),
  speed: 40,
};
const drive = (seq: number, track = "sunset-ridge") => ({
  type: "jevDrive",
  seq,
  track,
  ...POSE,
});

/** Lets resolved promises run: every microtask queued so far drains before setImmediate. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeDriver(
  decide: (options: JevRequestOptions) => Promise<JevAnswer> = () => Promise.resolve(ANSWER),
) {
  const driver = {
    kind: "stub" as const,
    decide: vi.fn((_pose: unknown, _track: unknown, options?: JevRequestOptions) =>
      decide(options ?? {}),
    ),
  };
  return driver satisfies JevDriver;
}

/** A decision that stays in flight until the test resolves it. */
function pendingDecision() {
  let resolve!: (answer: JevAnswer) => void;
  const promise = new Promise<JevAnswer>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function connect(application: RacingApplication): Promise<ClientSocket> {
  const client = new ClientSocket();
  application.connect(client.socket);
  await settle();
  expect(client.messages[0]?.type).toBe("welcome");
  client.messages.length = 0;
  return client;
}

describe("Jev live runs", () => {
  beforeEach(() => {
    vi.mocked(topEntries).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tells each driver in welcome whether Jev can drive", async () => {
    for (const driver of [fakeDriver(), null]) {
      const client = new ClientSocket();
      new RacingApplication(driver).connect(client.socket);
      await settle();
      expect(client.messages[0]).toMatchObject({ type: "welcome", jev: driver !== null });
    }
  });

  it("answers a pose outside any Room with Jev's decision, echoing its seq", async () => {
    const driver = fakeDriver();
    const client = await connect(new RacingApplication(driver));
    client.message(drive(7));
    await settle();

    expect(client.messages).toEqual([{ type: "jevDecision", seq: 7, ...ANSWER }]);
    expect(driver.decide).toHaveBeenCalledWith(POSE, SUNSET_RIDGE, {
      signal: expect.any(AbortSignal),
      timeoutMs: JEV_TIMEOUT_MS,
      maxRetries: 0,
    });
  });

  it("refuses a second request while one is in flight instead of queueing it", async () => {
    const first = pendingDecision();
    const driver = fakeDriver(() => first.promise);
    const client = await connect(new RacingApplication(driver));
    client.message(drive(1));
    client.message(drive(2));
    expect(client.messages).toEqual([{ type: "jevUnavailable", seq: 2, reason: "busy" }]);

    first.resolve(ANSWER);
    await settle();
    expect(client.messages.at(-1)).toMatchObject({ type: "jevDecision", seq: 1 });
    expect(driver.decide).toHaveBeenCalledTimes(1);

    client.message(drive(3));
    await settle();
    expect(client.messages.at(-1)).toMatchObject({ type: "jevDecision", seq: 3 });
  });

  it("caps each connection's request rate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const driver = fakeDriver();
    const application = new RacingApplication(driver);
    const client = await connect(application);
    let seq = 0;
    for (let i = 0; i < JEV_BURST; i++) {
      client.message(drive(++seq));
      await settle();
    }
    client.message(drive(++seq));
    expect(client.messages.at(-1)).toEqual({ type: "jevUnavailable", seq, reason: "rateLimited" });

    // Another connection has its own budget.
    const other = await connect(application);
    other.message(drive(1));
    await settle();
    expect(other.messages).toEqual([expect.objectContaining({ type: "jevDecision", seq: 1 })]);

    vi.advanceTimersByTime(1000 / JEV_RATE_PER_SECOND);
    client.message(drive(++seq));
    await settle();
    expect(client.messages.at(-1)).toMatchObject({ type: "jevDecision", seq });
    expect(driver.decide).toHaveBeenCalledTimes(JEV_BURST + 2);
  });

  it("caps the decisions in flight across every connection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const decisions: ReturnType<typeof pendingDecision>[] = [];
    const driver = fakeDriver(() => {
      const decision = pendingDecision();
      decisions.push(decision);
      return decision.promise;
    });
    const application = new RacingApplication(driver);
    for (let i = 0; i < JEV_MAX_IN_FLIGHT; i++) {
      // Paced under the server-wide rate, so only the in-flight cap can refuse.
      vi.advanceTimersByTime(1000 / JEV_SERVER_RATE_PER_SECOND);
      (await connect(application)).message(drive(1));
    }
    const late = await connect(application);
    late.message(drive(1));
    expect(late.messages).toEqual([{ type: "jevUnavailable", seq: 1, reason: "rateLimited" }]);

    decisions[0].resolve(ANSWER);
    await settle();
    late.message(drive(2));
    await settle();
    expect(driver.decide).toHaveBeenCalledTimes(JEV_MAX_IN_FLIGHT + 1);
  });

  it("caps the server-wide rate however many connections ask", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const driver = fakeDriver();
    const application = new RacingApplication(driver);
    const clients = [];
    for (let i = 0; i <= JEV_SERVER_RATE_PER_SECOND; i++) clients.push(await connect(application));
    for (const client of clients) {
      client.message(drive(1));
      await settle();
    }
    expect(clients.at(-2)!.messages.at(-1)).toMatchObject({ type: "jevDecision", seq: 1 });
    expect(clients.at(-1)!.messages).toEqual([
      { type: "jevUnavailable", seq: 1, reason: "rateLimited" },
    ]);

    vi.advanceTimersByTime(1000 / JEV_SERVER_RATE_PER_SECOND);
    clients.at(-1)!.message(drive(2));
    await settle();
    expect(clients.at(-1)!.messages.at(-1)).toMatchObject({ type: "jevDecision", seq: 2 });
    expect(driver.decide).toHaveBeenCalledTimes(JEV_SERVER_RATE_PER_SECOND + 1);
  });

  it("switches Jev off for the rest of the UTC day once the daily budget is spent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T23:59:00Z"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = fakeDriver();
    const application = new RacingApplication(driver, 2);
    const client = await connect(application);
    for (const seq of [1, 2, 3, 4]) {
      vi.advanceTimersByTime(1000);
      client.message(drive(seq));
      await settle();
    }
    expect(client.messages.slice(2)).toEqual([
      { type: "jevUnavailable", seq: 3, reason: "disabled" },
      { type: "jevUnavailable", seq: 4, reason: "disabled" },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-09-26T00:00:01Z"));
    client.message(drive(5));
    await settle();
    expect(client.messages.at(-1)).toMatchObject({ type: "jevDecision", seq: 5 });
    expect(driver.decide).toHaveBeenCalledTimes(3);
  });

  it("does not let a connection over its own limit drain the server's shared rate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const driver = fakeDriver();
    const application = new RacingApplication(driver);
    const spammer = await connect(application);
    for (let seq = 1; seq <= JEV_BURST + 30; seq++) {
      spammer.message(drive(seq));
      await settle();
    }
    const refused = spammer.messages.filter((m) => m.reason === "rateLimited");
    expect(refused).toHaveLength(30);

    // Every server token the spammer did not actually spend is still there for others.
    for (let i = 0; i < JEV_SERVER_RATE_PER_SECOND - JEV_BURST; i++) {
      const other = await connect(application);
      other.message(drive(1));
      await settle();
      expect(other.messages).toEqual([expect.objectContaining({ type: "jevDecision" })]);
    }
  });

  it("keeps counting the day's budget across a restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const usage = {
      decisionsOn: vi.fn(async (_day: string) => 9),
      add: vi.fn(async (_day: string, _decisions: number) => {}),
    };
    const driver = fakeDriver();
    const application = new RacingApplication(driver, 10, usage);
    await application.load();
    expect(usage.decisionsOn).toHaveBeenCalledWith("2026-09-25");

    const client = await connect(application);
    client.message(drive(1));
    await settle();
    vi.advanceTimersByTime(1000);
    client.message(drive(2));
    await settle();
    expect(client.messages).toEqual([
      expect.objectContaining({ type: "jevDecision", seq: 1 }),
      { type: "jevUnavailable", seq: 2, reason: "disabled" },
    ]);
    expect(usage.add).toHaveBeenCalledExactlyOnceWith("2026-09-25", 1);
  });

  it("stays off while today's usage cannot be read, and retries the read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const usage = {
      decisionsOn: vi
        .fn(async (_day: string) => 9)
        .mockRejectedValueOnce(new Error("connection refused")),
      add: vi.fn(async (_day: string, _decisions: number) => {}),
    };
    const driver = fakeDriver();
    const application = new RacingApplication(driver, 10, usage);
    await application.load();

    const client = await connect(application);
    client.message(drive(1));
    await settle();
    expect(client.messages).toEqual([{ type: "jevUnavailable", seq: 1, reason: "disabled" }]);
    expect(usage.decisionsOn).toHaveBeenCalledTimes(1);

    // The next request after the retry interval reads again; the one after that is counted.
    vi.advanceTimersByTime(30_000);
    client.message(drive(2));
    await settle();
    expect(usage.decisionsOn).toHaveBeenCalledTimes(2);
    client.message(drive(3));
    await settle();
    expect(client.messages.at(-1)).toMatchObject({ type: "jevDecision", seq: 3 });
    vi.advanceTimersByTime(1000);
    client.message(drive(4));
    await settle();
    expect(client.messages.at(-1)).toEqual({ type: "jevUnavailable", seq: 4, reason: "disabled" });
    expect(driver.decide).toHaveBeenCalledTimes(1);
  });

  it("keeps decisions a failed usage write could not save for the next write", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const usage = {
      decisionsOn: vi.fn(async (_day: string) => 0),
      add: vi
        .fn(async (_day: string, _decisions: number) => {})
        .mockRejectedValueOnce(new Error("connection refused")),
    };
    const application = new RacingApplication(fakeDriver(), 100, usage);
    (await connect(application)).message(drive(1));
    await settle();
    (await connect(application)).message(drive(1));
    await settle();
    expect(usage.add.mock.calls).toEqual([
      ["2026-09-25", 1],
      ["2026-09-25", 2],
    ]);
  });

  it("coalesces the usage writes made while one is still saving", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    const firstWrite = pendingDecision();
    const usage = {
      decisionsOn: vi.fn(async (_day: string) => 0),
      add: vi
        .fn(async (_day: string, _decisions: number) => {})
        .mockImplementationOnce(() => firstWrite.promise.then(() => {})),
    };
    const application = new RacingApplication(fakeDriver(), 100, usage);
    for (let i = 0; i < 3; i++) (await connect(application)).message(drive(1));
    await settle();
    expect(usage.add.mock.calls).toEqual([["2026-09-25", 1]]);

    firstWrite.resolve(ANSWER);
    await settle();
    expect(usage.add.mock.calls).toEqual([
      ["2026-09-25", 1],
      ["2026-09-25", 2],
    ]);
  });

  it("reads the daily budget from JEV_DAILY_DECISIONS", () => {
    expect(jevDailyDecisions({})).toBe(JEV_DEFAULT_DAILY_DECISIONS);
    expect(jevDailyDecisions({ JEV_DAILY_DECISIONS: "1200" })).toBe(1200);
    expect(jevDailyDecisions({ JEV_DAILY_DECISIONS: "0" })).toBe(0);
    for (const invalid of ["", " ", "-5", "1.5", "lots"])
      expect(jevDailyDecisions({ JEV_DAILY_DECISIONS: invalid })).toBe(JEV_DEFAULT_DAILY_DECISIONS);
  });

  it("answers failed rather than relay an implausible answer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = fakeDriver(() => Promise.resolve({ ...ANSWER, left: Number.NaN }));
    const client = await connect(new RacingApplication(driver));
    client.message(drive(1));
    await settle();
    expect(client.messages).toEqual([{ type: "jevUnavailable", seq: 1, reason: "failed" }]);
  });

  it("reports a failed decision and warns once a minute, not per failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = fakeDriver(() => Promise.reject(new Error("503 overloaded")));
    const client = await connect(new RacingApplication(driver));
    client.message(drive(1));
    await settle();
    client.message(drive(2));
    await settle();

    expect(client.messages).toEqual([
      { type: "jevUnavailable", seq: 1, reason: "failed" },
      { type: "jevUnavailable", seq: 2, reason: "failed" },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Jev decision failed: Error: 503 overloaded");
  });

  it("refuses without a driver, and off the one Track Jev was tuned for", async () => {
    const offline = await connect(new RacingApplication(null));
    offline.message(drive(1));
    expect(offline.messages).toEqual([{ type: "jevUnavailable", seq: 1, reason: "disabled" }]);

    const driver = fakeDriver();
    const client = await connect(new RacingApplication(driver));
    client.message(drive(2, "stormhaven"));
    expect(client.messages).toEqual([{ type: "jevUnavailable", seq: 2, reason: "disabled" }]);
    expect(driver.decide).not.toHaveBeenCalled();
  });

  it("aborts the decision in flight when the socket closes and sends nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = fakeDriver(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const client = await connect(new RacingApplication(driver));
    client.message(drive(1));
    const signal = driver.decide.mock.calls[0][2]?.signal;
    expect(signal?.aborted).toBe(false);

    client.close();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(client.messages).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("frees the aborted decision's server-wide slot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const driver = fakeDriver(
      ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const application = new RacingApplication(driver);
    const clients = [];
    for (let i = 0; i < JEV_MAX_IN_FLIGHT; i++) {
      vi.advanceTimersByTime(1000 / JEV_SERVER_RATE_PER_SECOND);
      const client = await connect(application);
      client.message(drive(1));
      clients.push(client);
    }
    clients[0].close();
    await settle();
    vi.advanceTimersByTime(1000 / JEV_SERVER_RATE_PER_SECOND);
    const late = await connect(application);
    late.message(drive(1));
    expect(late.messages).toEqual([]);
    expect(driver.decide).toHaveBeenCalledTimes(JEV_MAX_IN_FLIGHT + 1);
  });
});
