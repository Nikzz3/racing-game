// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceState, ServerMessage } from "@racing/shared";
import { RacingApp } from "./app";
import type { ConnectionState } from "./net";

const { connect, loadAssets, paintGarage, games } = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  loadAssets: vi.fn<() => Promise<void>>(),
  paintGarage: vi.fn<() => boolean>(),
  /** The messages each Game was handed, in the order it was created. */
  games: [] as ServerMessage[][],
}));
let reportStatus: (state: ConnectionState) => void;
let deliver: (message: ServerMessage) => void;
vi.mock("./net", () => ({
  Net: class {
    connect = connect;
    onMessage(callback: (message: ServerMessage) => void) {
      deliver = callback;
    }
    onStatus(callback: (state: ConnectionState) => void) {
      reportStatus = callback;
    }
  },
}));
vi.mock("./game/game", () => ({
  Game: class {
    private readonly messages: ServerMessage[] = [];
    constructor() {
      games.push(this.messages);
    }
    onMessage(message: ServerMessage) {
      this.messages.push(message);
    }
    setStandings() {}
    dispose() {}
  },
}));
vi.mock("./game/replay", () => ({ ReplayViewer: class {} }));
vi.mock("./game/models", () => ({ preloadModels: loadAssets }));
vi.mock("./ui/lobby", () => ({
  Lobby: class {
    paintGarageThumbnails = paintGarage;
    armedPacer = null;
    setConnection() {}
    show() {}
    hide() {}
  },
}));

beforeEach(() => {
  games.length = 0;
  connect.mockReset();
  loadAssets.mockReset().mockResolvedValue();
  paintGarage.mockReset().mockReturnValue(true);
});
afterEach(async () => {
  vi.useRealTimers();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  document.body.replaceChildren();
});

describe("reconnect notices", () => {
  beforeEach(() => vi.useFakeTimers());

  it("automatically retries failures with exponential backoff capped at 30 seconds", async () => {
    connect.mockRejectedValue(new Error("Server unavailable"));
    const app = new RacingApp(document.body);
    await app.start();
    for (const [index, delay] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(connect).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(connect).toHaveBeenCalledTimes(index + 2);
    }
  });

  it("reconnects after a dropped connection and resets backoff after success", async () => {
    connect.mockRejectedValueOnce(new Error("Server unavailable")).mockResolvedValue();
    const app = new RacingApp(document.body);
    await app.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".connect-error")).toBeNull();
    reportStatus("offline");
    expect(document.querySelector(".connect-error")?.textContent).toContain("automatically");
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(document.querySelector(".connect-error")).toBeNull();
  });

  it("schedules only one retry when both offline status and rejection report a failure", async () => {
    connect.mockImplementation(async () => {
      reportStatus("offline");
      throw new Error("Server unavailable");
    });
    const app = new RacingApp(document.body);
    await app.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("lets a manual reconnect replace the scheduled retry", async () => {
    connect.mockRejectedValueOnce(new Error("Server unavailable")).mockResolvedValue();
    const app = new RacingApp(document.body);
    await app.start();
    document.querySelector<HTMLButtonElement>(".connect-error button")!.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".connect-error")).toBeNull();
  });

  it("ignores a failed connection superseded by a newer successful attempt", async () => {
    let failFirst!: (error: Error) => void;
    connect.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failFirst = reject;
        }),
    );
    connect.mockResolvedValueOnce();
    const app = new RacingApp(document.body);
    const first = app.start();
    await app.start();
    failFirst(new Error("Old connection failed"));
    await first;
    expect(document.querySelector(".connect-error")).toBeNull();
  });

  it("suppresses deliberate cancellation while showing genuine connection failures", async () => {
    connect.mockRejectedValueOnce(new DOMException("Connection superseded", "AbortError"));
    const app = new RacingApp(document.body);
    await app.start();
    expect(document.querySelector(".connect-error")).toBeNull();

    connect.mockRejectedValueOnce(new Error("Server unavailable"));
    await app.start();
    expect(document.querySelector(".connect-error")?.textContent).toContain(
      "The racing server is unavailable",
    );
  });
});

describe("initial garage loading", () => {
  it("covers the lobby until assets resolve and the garage has initialized", async () => {
    let complete!: () => void;
    loadAssets.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    new RacingApp(document.body);
    expect(document.querySelector(".game-loading")).not.toBeNull();
    expect(paintGarage).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(paintGarage).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.querySelector(".game-loading.is-ready")).not.toBeNull());
  });

  it("keeps recovery controls available when the garage cannot initialize", async () => {
    paintGarage.mockReturnValue(false);
    new RacingApp(document.body);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>(".game-loading")?.dataset.state).toBe("error"),
    );
    expect(document.querySelector(".game-loading.is-ready")).toBeNull();
    expect(document.querySelector(".loading-status")!.textContent).toContain(
      "could not start on this device",
    );
  });
});

describe("joining a Room mid-race", () => {
  const joined: ServerMessage = {
    type: "joined",
    roomId: "r1",
    roomName: "Room",
    difficulty: "medium",
    track: "sunset-ridge",
  };
  const race: RaceState = {
    format: "knockout",
    phase: "racing",
    laps: 2,
    goT: 1_000,
    entrants: [{ id: "a", name: "A", slot: 0, laps: 0, status: "racing" }],
  };
  const pacers: ServerMessage = { type: "racePacers", pacers: [] };

  it("hands the Game the race sent while it was still loading, and forgets it on leaving", async () => {
    new RacingApp(document.body);
    deliver(joined);
    deliver(pacers);
    deliver({ type: "race", race });
    await vi.waitFor(() => expect(games).toHaveLength(1));
    expect(games[0]).toEqual([pacers, { type: "race", race }]);

    deliver({ type: "left" });
    deliver(joined);
    await vi.waitFor(() => expect(games).toHaveLength(2));
    expect(games[1]).toEqual([]);
  });
});
