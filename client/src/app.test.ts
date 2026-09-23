// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RacingApp } from "./app";
import type { ServerMessage } from "@racing/shared";
import type { ConnectionState } from "./net";

const { connect, loadAssets, paintGarage, links } = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  loadAssets: vi.fn<() => Promise<void>>(),
  paintGarage: vi.fn<() => boolean>(),
  links: [] as Array<{
    args: unknown[];
    setMembers: ReturnType<typeof vi.fn>;
    receiveSignal: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));
let reportStatus: (state: ConnectionState) => void;
let deliver: (message: ServerMessage) => void;
vi.mock("./net", () => ({
  Net: class {
    connect = connect;
    send = vi.fn();
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
    onMessage() {}
    dispose() {}
  },
}));
vi.mock("./direct-links", () => ({
  DirectLinks: class {
    static supported = () => true;
    setMembers = vi.fn();
    receiveSignal = vi.fn();
    dispose = vi.fn();
    constructor(...args: unknown[]) {
      const { setMembers, receiveSignal, dispose } = this;
      links.push({ args, setMembers, receiveSignal, dispose });
    }
  },
}));
vi.mock("./game/replay", () => ({ ReplayViewer: class {} }));
vi.mock("./game/models", () => ({ preloadModels: loadAssets }));
vi.mock("./ui/lobby", () => ({
  Lobby: class {
    paintGarageThumbnails = paintGarage;
    setConnection() {}
    setRooms() {}
    setLeaderboard() {}
    show() {}
    hide() {}
  },
}));

beforeEach(() => {
  connect.mockReset();
  loadAssets.mockReset().mockResolvedValue();
  paintGarage.mockReset().mockReturnValue(true);
  links.length = 0;
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

describe("Direct Links", () => {
  const joined = {
    type: "joined",
    roomId: "r1",
    roomName: "Dusk",
    difficulty: "medium",
    track: "sunset-ridge",
  } as const;

  it("opens links on joining, routes signals and membership to them, and closes them on leaving", () => {
    new RacingApp(document.body);
    deliver({ type: "welcome", playerId: "me", rooms: [], leaderboard: [] });
    const iceServers = [{ urls: "stun:stun.example.test:3478" }];
    deliver({ ...joined, iceServers });
    // Links open before the race view, which waits for assets: peers may signal first.
    expect(links).toHaveLength(1);
    expect(links[0].args.slice(0, 2)).toEqual(["me", iceServers]);

    const signal = { kind: "description", type: "offer", sdp: "v=0" } as const;
    deliver({ type: "signal", from: "p2", signal });
    expect(links[0].receiveSignal).toHaveBeenCalledWith("p2", signal);
    deliver({ type: "snapshot", t: 0, players: [] });
    expect(links[0].setMembers).toHaveBeenCalledWith([]);

    deliver({ type: "left" });
    expect(links[0].dispose).toHaveBeenCalledOnce();
  });

  it("never links through a server that predates Direct Links", () => {
    new RacingApp(document.body);
    deliver({ type: "welcome", playerId: "me", rooms: [], leaderboard: [] });
    deliver(joined);
    expect(links).toEqual([]);
  });
});
