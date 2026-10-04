import { describe, expect, it } from "vitest";
import { dailyChallenge, medalTimes } from "@racing/shared";
import { shareText } from "./daily-banner";

describe("shareText", () => {
  const challenge = {
    ...dailyChallenge(Date.parse("2027-02-22T12:00:00Z")),
    number: 142,
    track: "sunset-ridge",
    difficulty: "medium",
  } as const;

  it("is the Daily number and the best time, with no spoilers", () => {
    expect(shareText(challenge, 62310)).toBe("Sunset Ridge Daily #142 · 1:02.31");
  });

  it("ends with the Medal the time earns on the challenge's board", () => {
    const times = medalTimes(challenge.track, challenge.difficulty)!;
    expect(shareText(challenge, times.gold)).toMatch(/ · 🥇$/);
    expect(shareText(challenge, times.author)).toMatch(/ · 💎$/);
    // Slower than Bronze: the line ends at the time.
    expect(shareText(challenge, times.bronze + 10)).toMatch(/ · \d:\d\d\.\d\d$/);
  });

  it("truncates the time to centiseconds instead of rounding", () => {
    expect(shareText(challenge, 59999)).toBe("Sunset Ridge Daily #142 · 0:59.99");
  });
});
