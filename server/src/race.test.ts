import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_MS,
  GRACE_MS,
  RACE_LAPS,
  RESULTS_MS,
  SUNSET_RIDGE,
  type RaceFormat,
  type RacePacer,
  type ReplayFrame,
} from "@racing/shared";
import { gridPacers, Race } from "./race";

const CHECKPOINTS = SUNSET_RIDGE.checkpoints;
const N = CHECKPOINTS.length;
/** Every race here is called at t = 0. */
const GO = COUNTDOWN_MS;

function callRace(format: RaceFormat, drivers: string[], pacers: RacePacer[] = []): Race {
  return new Race(
    format,
    SUNSET_RIDGE,
    drivers.map((name) => ({ id: name, name })),
    pacers,
    0,
  );
}

/**
 * A Pacer whose recording reaches Checkpoint k at k/N of `lapMs` (entering its
 * radius a few hundred ms sooner) and is back on the line at `lapMs`.
 */
function pacer(id: string, lapMs: number): RacePacer {
  const frames = CHECKPOINTS.map(({ x, z }, k): ReplayFrame => [(k * lapMs) / N, x, z, 0, 0]);
  frames.push([lapMs, CHECKPOINTS[0].x, CHECKPOINTS[0].z, 0, 0]);
  return { id, name: id, frames };
}

/** Report a driver's timing once it has passed `count` Checkpoints since GO, the line included. */
function drive(race: Race, id: string, count: number, t: number): void {
  const laps = count ? Math.floor((count - 1) / N) : 0;
  race.driverProgress(id, { laps, next: (count - laps * N) % N, lapStartT: count ? 0 : null }, t);
}

/** The Checkpoints passed on completing `laps` laps: back across the line. */
const lap = (laps: number) => laps * N + 1;

function positions(race: Race, t: number): string[] {
  return race.tick(t)!.entrants.map(({ id, status }) => `${id} ${status}`);
}

describe("race", () => {
  it("holds the grid until GO, then ranks by Checkpoints passed, ties to whoever got there first", () => {
    const ranked = callRace("race", ["ava", "ben", "cy"]);
    expect(ranked.tick(0)).toMatchObject({ phase: "countdown", laps: RACE_LAPS, goT: GO });
    drive(ranked, "cy", 1, GO - 1);
    expect(positions(ranked, GO - 1)).toEqual(["ava racing", "ben racing", "cy racing"]);

    expect(ranked.tick(GO)?.phase).toBe("racing");
    drive(ranked, "ben", 2, GO + 1_000);
    drive(ranked, "cy", 2, GO + 2_000);
    drive(ranked, "ava", 1, GO + 2_500);
    expect(positions(ranked, GO + 3_000)).toEqual(["ben racing", "cy racing", "ava racing"]);
  });

  it("gives the rest GRACE_MS once the first car finishes, then shows results for RESULTS_MS", () => {
    const ranked = callRace("race", ["ava", "ben", "cy"]);
    ranked.tick(GO);
    drive(ranked, "ava", lap(RACE_LAPS), GO + 90_000);
    const deadline = GO + 90_000 + GRACE_MS;
    expect(ranked.tick(GO + 90_000)).toMatchObject({
      phase: "racing",
      deadlineT: deadline,
      entrants: [{ id: "ava", status: "finished", laps: RACE_LAPS, finishMs: 90_000 }, {}, {}],
    });

    drive(ranked, "ben", lap(RACE_LAPS), GO + 100_000);
    drive(ranked, "cy", lap(2), GO + 100_000);
    expect(positions(ranked, deadline - 1)).toEqual(["ava finished", "ben finished", "cy racing"]);
    expect(ranked.tick(deadline)).toMatchObject({
      phase: "results",
      deadlineT: deadline + RESULTS_MS,
      entrants: [{ id: "ava" }, { id: "ben", finishMs: 100_000 }, { id: "cy", status: "out" }],
    });
    expect(ranked.tick(deadline + RESULTS_MS)).toBeNull();
  });

  it("puts a driver who leaves out, ranking the later out ahead on equal progress", () => {
    const ranked = callRace("race", ["ava", "ben", "cy", "dan"]);
    ranked.tick(GO);
    drive(ranked, "ben", 5, GO + 10_000);
    drive(ranked, "cy", 5, GO + 11_000);
    drive(ranked, "dan", 8, GO + 12_000);
    ranked.leave("ben", GO + 20_000);
    ranked.leave("cy", GO + 21_000);
    ranked.leave("dan", GO + 22_000);
    drive(ranked, "dan", 9, GO + 23_000);
    expect(positions(ranked, GO + 30_000)).toEqual(["ava racing", "dan out", "cy out", "ben out"]);
  });
});

describe("knockout", () => {
  it("knocks out the last car to complete a lap as soon as the rest have", () => {
    const knockout = callRace("knockout", ["ava", "ben", "cy"]);
    expect(knockout.tick(GO)?.laps).toBe(2);
    drive(knockout, "ava", lap(1), GO + 40_000);
    expect(knockout.tick(GO + 40_000)?.deadlineT).toBe(GO + 40_000 + GRACE_MS);
    drive(knockout, "cy", lap(1), GO + 45_000);
    expect(positions(knockout, GO + 45_000)).toEqual(["ava racing", "cy racing", "ben out"]);
    expect(knockout.tick(GO + 45_000)?.deadlineT).toBeUndefined();

    drive(knockout, "cy", lap(2), GO + 80_000);
    expect(knockout.tick(GO + 80_000)).toMatchObject({
      phase: "results",
      entrants: [
        { id: "cy", status: "finished", finishMs: 80_000 },
        { id: "ava", status: "out" },
        { id: "ben", status: "out" },
      ],
    });
  });

  it("knocks out everyone who has not completed the lap GRACE_MS after the first car did", () => {
    const knockout = callRace("knockout", ["ava", "ben", "cy", "dan"]);
    knockout.tick(GO);
    drive(knockout, "ava", lap(1), GO + 40_000);
    drive(knockout, "ben", lap(1), GO + 50_000);
    drive(knockout, "cy", lap(1) - 1, GO + 50_000);
    const deadline = GO + 40_000 + GRACE_MS;
    expect(positions(knockout, deadline - 1)).toEqual([
      "ava racing",
      "ben racing",
      "cy racing",
      "dan racing",
    ]);
    expect(positions(knockout, deadline)).toEqual([
      "ava racing",
      "ben racing",
      "cy out",
      "dan out",
    ]);
    expect(knockout.tick(deadline)?.deadlineT).toBeUndefined();
  });
});

describe("grid Pacers", () => {
  it("drive their recorded lap from the line at GO, looping it, and finish like drivers", () => {
    const ranked = callRace("race", ["ava"], [pacer("pacer:1", 60_000)]);
    ranked.tick(GO);
    // The Pacer reached Checkpoint 1 near 5 s, ava at 7.5 s: equal progress, the Pacer first.
    drive(ranked, "ava", 2, GO + 7_500);
    expect(positions(ranked, GO + 7_500)).toEqual(["pacer:1 racing", "ava racing"]);
    drive(ranked, "ava", 3, GO + 8_000);
    expect(positions(ranked, GO + 8_000)).toEqual(["ava racing", "pacer:1 racing"]);
    expect(ranked.tick(GO + 61_000)?.entrants[0]).toMatchObject({ id: "pacer:1", laps: 1 });

    expect(ranked.tick(GO + 180_000)).toMatchObject({
      deadlineT: GO + 180_000 + GRACE_MS,
      entrants: [
        { id: "pacer:1", pacer: true, slot: 1, laps: RACE_LAPS, finishMs: 180_000 },
        { id: "ava", status: "racing" },
      ],
    });
  });

  it("are knocked out and win a Knockout like drivers", () => {
    const knockout = callRace("knockout", ["ava"], [pacer("fast", 50_000), pacer("slow", 70_000)]);
    knockout.tick(GO);
    drive(knockout, "ava", lap(1), GO + 60_000);
    expect(positions(knockout, GO + 60_000)).toEqual(["fast racing", "ava racing", "slow out"]);
    expect(knockout.tick(GO + 100_000)).toMatchObject({
      phase: "results",
      entrants: [
        { id: "fast", status: "finished", finishMs: 100_000 },
        { id: "ava", status: "out" },
        { id: "slow", status: "out" },
      ],
    });
  });

  it("are played out at once when no driver is left racing", () => {
    const ranked = callRace("race", ["ava"], [pacer("fast", 55_000), pacer("slow", 65_000)]);
    ranked.tick(GO);
    drive(ranked, "ava", lap(RACE_LAPS), GO + 150_000);
    // Within the grace, fast finishes at 165 s; slow would only at 195 s.
    expect(ranked.tick(GO + 150_000)).toMatchObject({
      phase: "results",
      deadlineT: GO + 150_000 + RESULTS_MS,
      entrants: [
        { id: "ava", status: "finished", finishMs: 150_000 },
        { id: "fast", status: "finished", finishMs: 165_000 },
        { id: "slow", status: "out", laps: 2 },
      ],
    });
  });

  it("fill the empty slots with the fastest Replays not recorded under an entrant's name", () => {
    const frames: ReplayFrame[] = [
      [0, 0, 0, 0, 0],
      [60_000, 0, 0, 0, 0],
    ];
    const replays = ["Ava", "R1", "R2", "R3", "R4", "R5"].map((name) => ({ name, frames }));
    expect(gridPacers(["Ava", "Ben"], replays).map(({ id, name }) => `${id} ${name}`)).toEqual([
      "pacer:1 R1",
      "pacer:2 R2",
      "pacer:3 R3",
      "pacer:4 R4",
    ]);
    expect(gridPacers(["A", "B", "C", "D", "E", "F"], replays)).toEqual([]);
  });
});
