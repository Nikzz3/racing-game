import type { ReplayFrame } from "@racing/shared";
import bundled from "./jev-lap.json";
import type { JevRecordedDecision, JevRecording } from "./jev-recording";

/**
 * The Jev Lap (ADR-0009): one lap Jev drove headlessly, recorded by
 * `npm run jev:record` and bundled so players replay it offline at no API
 * cost. Null if the bundled file is malformed, which hides it in the lobby.
 */
export const JEV_LAP: JevRecording | null = parseJevLap(bundled);

/** A frame or a decision: five finite numbers, time first. */
function isTuple(value: unknown): value is [number, number, number, number, number] {
  return Array.isArray(value) && value.length === 5 && value.every((n) => Number.isFinite(n));
}

/** The recording, if it has the shape the replay relies on; otherwise null. */
export function parseJevLap(value: unknown): JevRecording | null {
  if (typeof value !== "object" || value === null) return null;
  const { model, timeMs, frames, decisions } = value as Partial<Record<string, unknown>>;
  if (typeof model !== "string" || typeof timeMs !== "number" || !(timeMs > 0)) return null;
  if (!Array.isArray(frames) || frames.length < 2 || !frames.every(isTuple)) return null;
  if (!Array.isArray(decisions) || !decisions.every(isTuple)) return null;
  return {
    model,
    timeMs,
    frames: frames satisfies ReplayFrame[],
    decisions: decisions satisfies JevRecordedDecision[],
  };
}
