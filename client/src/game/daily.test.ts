import { describe, expect, it } from "vitest";
import {
  CAR_VARIANTS,
  dailyChallenge,
  dailyEndsAt,
  DIFFICULTIES,
  SCENE_PRESETS,
  TRACKS,
  variantUnlocked,
} from "@racing/shared";

describe("dailyChallenge", () => {
  it("numbers the release day #1 and counts up per UTC day", () => {
    expect(dailyChallenge(Date.parse("2026-10-04T00:00:00Z"))).toMatchObject({
      number: 1,
      date: "2026-10-04",
    });
    expect(dailyChallenge(Date.parse("2026-10-05T23:59:59.999Z"))).toMatchObject({
      number: 2,
      date: "2026-10-05",
    });
  });

  it("gives everyone the same challenge all UTC day, and closes at UTC midnight", () => {
    const morning = dailyChallenge(Date.parse("2027-03-14T00:00:00Z"));
    expect(dailyChallenge(Date.parse("2027-03-14T23:59:59.999Z"))).toEqual(morning);
    expect(dailyEndsAt(morning)).toBe(Date.parse("2027-03-15T00:00:00Z"));
    expect(dailyChallenge(dailyEndsAt(morning)).date).toBe("2027-03-15");
  });

  it("draws every pick from the known Tracks, Difficulties, free Variants and scenes", () => {
    const tracks = new Set(TRACKS.map((track) => track.id));
    const freeVariants = CAR_VARIANTS.filter((variant) => variantUnlocked(variant, null));
    const seen = { track: new Set(), difficulty: new Set(), variant: new Set(), scene: new Set() };
    for (let day = 0; day < 365; day++) {
      const challenge = dailyChallenge(Date.parse("2026-10-04T12:00:00Z") + day * 86_400_000);
      expect(tracks).toContain(challenge.track);
      expect(DIFFICULTIES).toContain(challenge.difficulty);
      expect(freeVariants).toContain(challenge.variant);
      expect(SCENE_PRESETS).toContain(challenge.scene);
      for (const key of ["track", "difficulty", "variant", "scene"] as const)
        seen[key].add(challenge[key]);
    }
    // A year of days reaches every option, so no pick is stuck on one value.
    expect(seen.track.size).toBe(TRACKS.length);
    expect(seen.difficulty.size).toBe(DIFFICULTIES.length);
    expect(seen.variant.size).toBe(freeVariants.length);
    expect(seen.scene.size).toBe(SCENE_PRESETS.length);
  });
});
