import { describe, expect, it } from "vitest";
import type { RaceEntrant, RaceState, ReplayFrame } from "@racing/shared";
import {
  cycleTarget,
  driveMode,
  gridPacerPose,
  raceEvents,
  raceRole,
  racingIds,
  spectatorTarget,
} from "./race";

function entrant(id: string, status: RaceEntrant["status"] = "racing"): RaceEntrant {
  return { id, name: id.toUpperCase(), slot: 0, laps: 0, status };
}

function race(entrants: RaceEntrant[], overrides: Partial<RaceState> = {}): RaceState {
  return { format: "race", phase: "racing", laps: 3, goT: 10_000, entrants, ...overrides };
}

describe("the local driver's part in a race", () => {
  const field = race([entrant("a"), entrant("me"), entrant("b", "finished")]);

  it("drives freely without a race", () => {
    expect(raceRole(null, "me")).toBe("free");
    expect(driveMode(null, "me", 0)).toBe("drive");
  });

  it("holds an entrant on the grid until GO, then drives", () => {
    const countdown = { ...field, phase: "countdown" as const };
    expect(raceRole(countdown, "me")).toBe("racing");
    expect(driveMode(countdown, "me", 9_999)).toBe("hold");
    // GO is the server's clock reaching goT, whatever phase the last state said.
    expect(driveMode(countdown, "me", 10_000)).toBe("drive");
  });

  it("spectates when not racing: joined mid-race, finished or out, and once results are up", () => {
    expect(raceRole(field, "late")).toBe("spectating");
    expect(raceRole(field, "b")).toBe("spectating");
    expect(raceRole({ ...field, phase: "results" }, "me")).toBe("spectating");
    expect(driveMode(field, "b", 0)).toBe("spectate");
  });

  it("draws only the cars still racing while a race exists", () => {
    expect(racingIds(null)).toBeNull();
    expect(racingIds(field)).toEqual(new Set(["a", "me"]));
  });
});

describe("the car a Spectator watches", () => {
  const field = race([entrant("x", "finished"), entrant("a"), entrant("b"), entrant("c")]);

  it("starts on the leader still racing and keeps a chosen car while it races", () => {
    expect(spectatorTarget(field, null)?.id).toBe("a");
    expect(spectatorTarget(field, "c")?.id).toBe("c");
  });

  it("falls back to the leader once the watched car stops racing, and to none after the last", () => {
    expect(spectatorTarget(field, "x")?.id).toBe("a");
    expect(spectatorTarget(race([entrant("a", "out")]), "a")).toBeNull();
    expect(spectatorTarget(null, "a")).toBeNull();
  });

  it("cycles through the cars still racing in position order, wrapping both ways", () => {
    expect(cycleTarget(field, "a", 1)).toBe("b");
    expect(cycleTarget(field, "c", 1)).toBe("a");
    expect(cycleTarget(field, "a", -1)).toBe("c");
    // From a car that stopped racing, the step counts from the leader shown instead.
    expect(cycleTarget(field, "x", 1)).toBe("b");
    expect(cycleTarget(race([]), "a", 1)).toBeNull();
  });
});

describe("gridPacerPose", () => {
  const frames: ReplayFrame[] = [
    [0, 0, 0, 0, 10],
    [1000, 100, 0, 0, 20],
    [2000, 100, 100, 0, 30],
  ];

  it("is hidden before GO and starts the lap from the line at GO", () => {
    expect(gridPacerPose(frames, 5_000, 4_999)).toBeNull();
    expect(gridPacerPose(frames, 5_000, 5_000)).toMatchObject({ x: 0, z: 0 });
    expect(gridPacerPose(frames, 5_000, 5_500)).toMatchObject({ x: 50, z: 0, speed: 15 });
  });

  it("loops the recorded lap", () => {
    expect(gridPacerPose(frames, 5_000, 7_500)).toMatchObject({ x: 50, z: 0 });
    expect(gridPacerPose(frames, 5_000, 8_000)).toMatchObject({ x: 100, z: 0 });
  });

  it("has no pose without a lap to drive", () => {
    expect(gridPacerPose([], 0, 100)).toBeNull();
    expect(gridPacerPose([[0, 1, 1, 0, 0]], 0, 100)).toBeNull();
  });
});

describe("raceEvents", () => {
  const knockout = race([entrant("a"), entrant("me"), entrant("b")], { format: "knockout" });

  it("announces each Knockout elimination once", () => {
    const next = race([entrant("a"), entrant("me"), entrant("b", "out")], { format: "knockout" });
    expect(raceEvents(knockout, next, "me")).toEqual(["B is out"]);
    expect(raceEvents(next, next, "me")).toEqual([]);
  });

  it("announces the local driver's finish with their position, and no one else's", () => {
    const next = race([entrant("a", "finished"), entrant("me", "finished"), entrant("b")]);
    expect(raceEvents(race(knockout.entrants), next, "me")).toEqual(["You finished P2"]);
  });

  it("leaves the last elimination or finish to the results screen", () => {
    const over = race([entrant("a", "finished"), entrant("me", "out"), entrant("b", "out")], {
      format: "knockout",
      phase: "results",
    });
    expect(raceEvents(knockout, over, "me")).toEqual([]);
  });

  it("calls a Race's DNF nothing", () => {
    const next = race([entrant("a"), entrant("me"), entrant("b", "out")]);
    expect(raceEvents(race(knockout.entrants), next, "me")).toEqual([]);
  });

  it("compares only states of the same race", () => {
    const next = race([entrant("a", "out")], { format: "knockout", goT: 20_000 });
    expect(raceEvents(knockout, next, "me")).toEqual([]);
    expect(raceEvents(null, knockout, "me")).toEqual([]);
    expect(raceEvents(knockout, null, "me")).toEqual([]);
  });
});
