import { describe, expect, it } from "vitest";
import { dailyChallenge } from "@racing/shared";
import { shareText } from "./daily-banner";

describe("shareText", () => {
  const challenge = { ...dailyChallenge(Date.parse("2027-02-22T12:00:00Z")), number: 142 };

  it("is the Daily number and the best time, with no spoilers", () => {
    expect(shareText(challenge, 62310)).toBe("Sunset Ridge Daily #142 · 1:02.31");
  });

  it("truncates the time to centiseconds instead of rounding", () => {
    expect(shareText(challenge, 59999)).toBe("Sunset Ridge Daily #142 · 0:59.99");
  });
});
