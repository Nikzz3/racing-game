// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@racing/shared";
import { RacingApp } from "./app";
import type { ConnectionState } from "./net";
import type { JevLiveCallbacks } from "./game/jev-live";
import type { JevLiveAnswer } from "./game/jev-live-run";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(message: ClientMessage) => void>(),
  lobbyShow: vi.fn(),
  lobbyHide: vi.fn(),
  liveOpened: vi.fn<(callbacks: JevLiveCallbacks) => void>(),
  liveReceive: vi.fn<(answer: JevLiveAnswer) => void>(),
  liveDispose: vi.fn(),
  replayOpened: vi.fn<(...args: unknown[]) => void>(),
  setJevAvailable: vi.fn<(available: boolean) => void>(),
  liveFails: { value: false },
}));
let receive: (message: ServerMessage) => void;
let reportStatus: (state: ConnectionState) => void;
let lobbyCallbacks: { onJevLive(): void };

vi.mock("./net", () => ({
  Net: class {
    connect = vi.fn();
    send = mocks.send;
    onMessage(callback: (message: ServerMessage) => void) {
      receive = callback;
    }
    onStatus(callback: (state: ConnectionState) => void) {
      reportStatus = callback;
    }
  },
}));
vi.mock("./game/game", () => ({ Game: class {} }));
vi.mock("./game/replay", () => ({
  ReplayViewer: class {
    constructor(...args: unknown[]) {
      mocks.replayOpened(...args);
    }
    dispose() {}
  },
}));
vi.mock("./game/jev-live", () => ({
  JevLiveViewer: class {
    constructor(_parent: HTMLElement, callbacks: JevLiveCallbacks) {
      if (mocks.liveFails.value) throw new Error("no WebGL");
      mocks.liveOpened(callbacks);
    }
    receive = mocks.liveReceive;
    dispose = mocks.liveDispose;
  },
}));
vi.mock("./game/models", () => ({ preloadModels: () => Promise.resolve() }));
vi.mock("./ui/lobby", () => ({
  Lobby: class {
    constructor(_root: HTMLElement, callbacks: { onJevLive(): void }) {
      lobbyCallbacks = callbacks;
    }
    paintGarageThumbnails = () => true;
    setConnection() {}
    setJevAvailable = mocks.setJevAvailable;
    show = mocks.lobbyShow;
    hide = mocks.lobbyHide;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.liveFails.value = false;
});
afterEach(async () => {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  document.body.replaceChildren();
});

async function openLive(): Promise<JevLiveCallbacks> {
  new RacingApp(document.body);
  lobbyCallbacks.onJevLive();
  await vi.waitFor(() => expect(mocks.liveOpened).toHaveBeenCalledOnce());
  return mocks.liveOpened.mock.calls[0][0];
}

const answer: JevLiveAnswer = {
  type: "jevDecision",
  seq: 4,
  accelerate: 0.9,
  left: 0.3,
  pedalConfidence: 0.8,
  steerConfidence: 0.4,
  latencyMs: 240,
  model: "jev-1.13.0",
};

describe("Jev Live Run in the app", () => {
  it("opens over the hidden lobby and asks for decisions on Sunset Ridge", async () => {
    const { requestDecision } = await openLive();
    expect(mocks.lobbyHide).toHaveBeenCalled();
    requestDecision({ x: 1, z: 2, heading: 0.5, speed: 30 }, 7);
    expect(mocks.send).toHaveBeenCalledWith({
      type: "jevDrive",
      seq: 7,
      track: "sunset-ridge",
      x: 1,
      z: 2,
      heading: 0.5,
      speed: 30,
    });
  });

  it("routes Jev's answers to the live run", async () => {
    await openLive();
    receive(answer);
    receive({ type: "jevUnavailable", seq: 5, reason: "busy" });
    expect(mocks.liveReceive.mock.calls).toEqual([
      [answer],
      [{ type: "jevUnavailable", seq: 5, reason: "busy" }],
    ]);
  });

  it("drops Jev's answers when no live run is open", async () => {
    new RacingApp(document.body);
    receive(answer);
    await Promise.resolve();
    expect(mocks.liveReceive).not.toHaveBeenCalled();
  });

  it("closes the run and shows the lobby when the connection drops", async () => {
    await openLive();
    reportStatus("offline");
    // No server to ask until the next welcome, so the lobby stops offering the live run.
    expect(mocks.setJevAvailable).toHaveBeenLastCalledWith(false);
    expect(mocks.liveDispose).toHaveBeenCalled();
    expect(mocks.lobbyShow).toHaveBeenCalled();
    receive(answer);
    expect(mocks.liveReceive).not.toHaveBeenCalled();
  });

  it("replays a finished run in Jev's car", async () => {
    const { onReplay } = await openLive();
    const frames: [number, number, number, number, number][] = [
      [0, 0, 0, 0, 0],
      [36_500, 1, 1, 0, 50],
    ];
    onReplay({ model: "jev-1.13.0", timeMs: 36_500, frames, decisions: [] });
    await vi.waitFor(() => expect(mocks.replayOpened).toHaveBeenCalledOnce());
    expect(mocks.replayOpened.mock.calls[0].slice(1, 6)).toEqual([
      "Jev",
      "sunset-ridge",
      36_500,
      frames,
      "race-future",
    ]);
  });

  it("returns to the lobby with a notice when the run cannot start", async () => {
    mocks.liveFails.value = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    new RacingApp(document.body);
    lobbyCallbacks.onJevLive();
    await vi.waitFor(() =>
      expect(document.querySelector(".connect-error")?.textContent).toContain(
        "live run could not start",
      ),
    );
    expect(mocks.lobbyShow).toHaveBeenCalled();
  });
});
