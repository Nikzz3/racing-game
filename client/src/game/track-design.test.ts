import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIFFICULTIES, TRACKS } from "@racing/shared";
import { runRacingLineLap } from "./harness";
import { MIN_CLEARANCE, MIN_GATE_CHORD_RATIO, measureTrack } from "./track-design";

// The game's invariants for every Track. `npm run track:check` adds the stricter
// "tidy lap" bar and the design brief that new Tracks are drawn against.
describe.each(TRACKS)("$name layout", (track) => {
  const design = measureTrack(track);

  it("keeps separate stretches of road far enough apart for their barriers", () => {
    expect(design.clearance.metres).toBeGreaterThanOrEqual(MIN_CLEARANCE);
  });

  it("places its checkpoints on the road, in lap order", () => {
    expect(design.misplacedGates).toEqual([]);
  });

  it("spaces its checkpoints so cutting across the grass does not pay", () => {
    expect(design.worstGateChordRatio).toBeGreaterThanOrEqual(MIN_GATE_CHORD_RATIO);
  });

  it.each(DIFFICULTIES)("can be lapped on %s", (difficulty) => {
    expect(runRacingLineLap({ track, difficulty, maxSteps: 60 * 400 })).not.toBeNull();
  });
});

it("registers every track source in TRACKS", () => {
  const sources = readdirSync(new URL("../../../shared/src/tracks", import.meta.url))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
  expect(TRACKS.map((track) => track.id).sort()).toEqual(sources.sort());
});
