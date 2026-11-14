import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { MAX_QUEUED_BYTES, sendEncoded } from "./transport";

describe("sendEncoded", () => {
  it("cuts off a socket that stopped reading instead of queueing without bound", () => {
    const socket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: MAX_QUEUED_BYTES + 1,
      send: vi.fn(),
      terminate: vi.fn(),
    };
    sendEncoded(socket as unknown as WebSocket, "{}");
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
  });
});
