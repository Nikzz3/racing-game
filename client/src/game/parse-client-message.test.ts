import { describe, expect, it } from "vitest";
import { parseClientMessage } from "@racing/shared";

describe("parseClientMessage", () => {
  it("accepts a well-formed hello", () => {
    expect(parseClientMessage({ type: "hello", name: "Ada" })).toEqual({
      type: "hello",
      name: "Ada",
    });
  });

  it("rejects a hello with a missing name (the original crash frame)", () => {
    // Before validation, `msg.name.trim()` on the server threw a TypeError that
    // escaped the ws listener uncaught and killed the whole process.
    expect(parseClientMessage({ type: "hello" })).toBeNull();
    expect(parseClientMessage({ type: "hello", name: 123 })).toBeNull();
  });

  it("carries a valid hello variant through", () => {
    expect(parseClientMessage({ type: "hello", name: "Ada", variant: "taxi" })).toEqual({
      type: "hello",
      name: "Ada",
      variant: "taxi",
    });
  });

  it("normalizes an unknown hello variant to absent instead of coercing it", () => {
    const msg = parseClientMessage({ type: "hello", name: "Ada", variant: "batmobile" });
    expect(msg).toEqual({ type: "hello", name: "Ada" });
    expect((msg as { variant?: string }).variant).toBeUndefined();
  });

  it("leaves an omitted hello variant absent", () => {
    const msg = parseClientMessage({ type: "hello", name: "Ada" });
    expect((msg as { variant?: string }).variant).toBeUndefined();
  });

  it("rejects a createRoom with no roomName", () => {
    expect(parseClientMessage({ type: "createRoom" })).toBeNull();
  });

  it("coerces unknown difficulty and track on createRoom instead of trusting them", () => {
    expect(
      parseClientMessage({ type: "createRoom", roomName: "R", difficulty: "impossible", track: "atlantis" })
    ).toEqual({ type: "createRoom", roomName: "R", difficulty: "medium", track: "sunset-ridge" });
  });

  it("accepts finite-number state frames", () => {
    expect(
      parseClientMessage({ type: "state", x: 1, y: 2, z: 3, rot: 0.5, speed: 40 })
    ).toEqual({ type: "state", x: 1, y: 2, z: 3, rot: 0.5, speed: 40 });
  });

  it("rejects NaN / Infinity / non-number state coordinates", () => {
    expect(parseClientMessage({ type: "state", x: NaN, y: 0, z: 0, rot: 0, speed: 0 })).toBeNull();
    expect(parseClientMessage({ type: "state", x: 0, y: 0, z: Infinity, rot: 0, speed: 0 })).toBeNull();
    expect(parseClientMessage({ type: "state", x: "0", y: 0, z: 0, rot: 0, speed: 0 })).toBeNull();
    expect(parseClientMessage({ type: "state", x: 0, y: 0, z: 0, rot: 0 })).toBeNull();
  });

  it("validates getReplay and joinRoom string fields", () => {
    expect(
      parseClientMessage({ type: "getReplay", name: "Ada", difficulty: "hard", track: "stormhaven" })
    ).toEqual({ type: "getReplay", name: "Ada", difficulty: "hard", track: "stormhaven" });
    expect(parseClientMessage({ type: "getReplay" })).toBeNull();
    expect(parseClientMessage({ type: "joinRoom", roomId: "abc123" })).toEqual({
      type: "joinRoom",
      roomId: "abc123",
    });
    expect(parseClientMessage({ type: "joinRoom" })).toBeNull();
  });

  it("rejects junk that is not a message at all", () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage("hello")).toBeNull();
    expect(parseClientMessage(42)).toBeNull();
    expect(parseClientMessage({})).toBeNull();
    expect(parseClientMessage({ type: "nonsense" })).toBeNull();
  });

  it("accepts the no-payload messages", () => {
    expect(parseClientMessage({ type: "leaveRoom" })).toEqual({ type: "leaveRoom" });
    expect(parseClientMessage({ type: "respawn" })).toEqual({ type: "respawn" });
  });
});
