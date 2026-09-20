import { describe, it, expect } from "vitest";
import type { LeaderboardEntry, ClientMessage } from "@racing/shared";

describe("LeaderboardEntry carries track", () => {
  it("can be constructed with a track field", () => {
    const entry: LeaderboardEntry = {
      name: "Alice",
      timeMs: 45000,
      date: "2026-07-05T00:00:00.000Z",
      hasReplay: false,
      difficulty: "medium",
      track: "sunset-ridge",
    };
    expect(entry.track).toBe("sunset-ridge");
  });
});

describe("getReplay message carries track", () => {
  it("getReplay ClientMessage includes a track field", () => {
    const msg: ClientMessage & { type: "getReplay" } = {
      type: "getReplay",
      name: "Alice",
      difficulty: "medium",
      track: "sunset-ridge",
    };
    expect(msg.track).toBe("sunset-ridge");
  });
});
