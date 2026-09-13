import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Net } from "./net";

class BrowserSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: BrowserSocket[] = [];
  readyState = 0;

  constructor(readonly url: string) {
    super();
    BrowserSocket.instances.push(this);
  }

  close(): void {
    this.readyState = 2;
  }
  send(): void {}
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(value: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}

beforeEach(() => {
  BrowserSocket.instances = [];
  vi.stubGlobal("WebSocket", BrowserSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("WebSocket replacement", () => {
  it("ignores messages queued by the old connection after reconnecting", async () => {
    const net = new Net();
    const receive = vi.fn();
    net.onMessage(receive);
    const first = net.connect("ws://first");
    BrowserSocket.instances[0].open();
    await first;

    const second = net.connect("ws://second");
    BrowserSocket.instances[1].open();
    await second;
    BrowserSocket.instances[0].message({ type: "left" });
    BrowserSocket.instances[1].message({ type: "rooms", rooms: [] });

    expect(receive.mock.calls).toEqual([[{ type: "rooms", rooms: [] }]]);
  });

  it("does not announce connected when a superseded socket opens", async () => {
    const net = new Net();
    const status = vi.fn();
    net.onStatus(status);
    void net.connect("ws://first").catch(() => {});
    const second = net.connect("ws://second");
    BrowserSocket.instances[0].open();
    expect(status.mock.calls).toEqual([["connecting"], ["connecting"]]);
    BrowserSocket.instances[1].open();
    await second;
    expect(status.mock.calls.at(-1)).toEqual(["connected"]);
  });

  it("rejects the superseded connection with an identifiable cancellation", async () => {
    const net = new Net();
    const rejected = vi.fn();
    void net.connect("ws://first").catch(rejected);
    const second = net.connect("ws://second");
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AbortError" }),
    );
    BrowserSocket.instances[1].open();
    await second;
  });
});
