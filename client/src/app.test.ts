// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RacingApp } from "./app";

const { connect } = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
}));
vi.mock("./net", () => ({
  Net: class {
    connect = connect;
    onMessage() {}
    onStatus() {}
  },
}));
vi.mock("./game/game", () => ({ Game: class {} }));
vi.mock("./game/replay", () => ({ ReplayViewer: class {} }));
vi.mock("./game/models", () => ({ preloadModels: () => Promise.resolve() }));
vi.mock("./ui/lobby", () => ({
  Lobby: class {
    paintGarageThumbnails() {}
  },
}));

beforeEach(() => {
  connect.mockReset();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe("reconnect notices", () => {
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
    connect.mockRejectedValueOnce(
      new DOMException("Connection superseded", "AbortError"),
    );
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
