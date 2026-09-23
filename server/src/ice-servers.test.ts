import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ICE_SERVERS, parseIceServers } from "./ice-servers";

describe("parseIceServers", () => {
  it("defaults to public STUN when unset", () => {
    expect(parseIceServers(undefined)).toBe(DEFAULT_ICE_SERVERS);
  });

  it("reads a TURN entry with credentials, and an empty list for loopback-only runs", () => {
    const turn = { urls: ["turn:turn.example.test:3478"], username: "u", credential: "c" };
    expect(parseIceServers(JSON.stringify([turn]))).toEqual([turn]);
    expect(parseIceServers("[]")).toEqual([]);
  });

  it("falls back to the default rather than handing clients a malformed list", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const raw of ["not json", "{}", '[{"urls":5}]', "[null]"])
      expect(parseIceServers(raw)).toBe(DEFAULT_ICE_SERVERS);
    expect(error).toHaveBeenCalledTimes(4);
    error.mockRestore();
  });
});
