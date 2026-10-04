// The server runs a Race (see CONTEXT.md) and publishes it as a RaceState; the
// client only renders it. These are the rules for what the local driver does
// in each of its states, kept free of the scene so they can be tested alone.

import type { RaceEntrant, RaceState, ReplayFrame } from "@racing/shared";
import { interpolatePose, type Pose } from "./pose-interpolation";

/**
 * Free driving without a race; racing as an entrant still racing; or spectating:
 * in the Room while a race counts down or runs without racing in it, and
 * everyone once its results are up.
 */
export type RaceRole = "free" | "racing" | "spectating";

/** What the local car does this frame: drives, waits on its grid slot for GO, or sits out while its driver spectates. */
export type DriveMode = "drive" | "hold" | "spectate";

export function raceRole(race: RaceState | null, myId: string): RaceRole {
  if (!race) return "free";
  if (race.phase === "results") return "spectating";
  return race.entrants.some((e) => e.id === myId && e.status === "racing")
    ? "racing"
    : "spectating";
}

export function driveMode(race: RaceState | null, myId: string, serverNow: number): DriveMode {
  const role = raceRole(race, myId);
  if (role === "spectating") return "spectate";
  return role === "racing" && serverNow < race!.goT ? "hold" : "drive";
}

/** The cars still racing, in position order. */
function stillRacing(race: RaceState | null): RaceEntrant[] {
  return race?.entrants.filter((e) => e.status === "racing") ?? [];
}

/** While a race exists only its cars still racing are drawn and solid; null draws everyone. */
export function racingIds(race: RaceState | null): Set<string> | null {
  return race && new Set(stillRacing(race).map((e) => e.id));
}

/** The car a Spectator watches: `current` while it is still racing, else the leader; null once none is. */
export function spectatorTarget(
  race: RaceState | null,
  current: string | null,
): RaceEntrant | null {
  const racing = stillRacing(race);
  return racing.find((e) => e.id === current) ?? racing[0] ?? null;
}

/** The car `step` places away from the watched one among those still racing, wrapping around. */
export function cycleTarget(
  race: RaceState | null,
  current: string | null,
  step: 1 | -1,
): string | null {
  const racing = stillRacing(race);
  if (!racing.length) return null;
  // A watched car that stopped racing has already given way to the leader.
  const index = Math.max(
    racing.findIndex((e) => e.id === current),
    0,
  );
  return racing[(index + step + racing.length) % racing.length].id;
}

/** A grid Pacer drives its recorded flying lap from the line at GO, looping it; null before GO. */
export function gridPacerPose(frames: ReplayFrame[], goT: number, serverNow: number): Pose | null {
  const lapMs = frames.at(-1)?.[0] ?? 0;
  const elapsed = serverNow - goT;
  if (lapMs <= 0 || elapsed < 0) return null;
  return interpolatePose(frames, elapsed % lapMs);
}

/**
 * Toasts for what changed between two states of one race: Knockout eliminations,
 * and the local driver's finish. None once the results are up: they say it all.
 */
export function raceEvents(
  previous: RaceState | null,
  next: RaceState | null,
  myId: string,
): string[] {
  if (!previous || !next || previous.goT !== next.goT || next.phase === "results") return [];
  const before = new Map(previous.entrants.map((e) => [e.id, e.status]));
  return next.entrants.flatMap((entrant, index) => {
    if (before.get(entrant.id) !== "racing") return [];
    if (entrant.status === "out" && next.format === "knockout") return [`${entrant.name} is out`];
    if (entrant.status === "finished" && entrant.id === myId) return [`You finished P${index + 1}`];
    return [];
  });
}
