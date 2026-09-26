import type { ReplayFrame } from "@racing/shared";
import bundled from "./jev-lap.json";
import type { JevRecordedDecision, JevRecording } from "./jev-recording";

/**
 * The Jev Lap (ADR-0009): one lap Jev drove headlessly, recorded by
 * `npm run jev:record` and bundled so players replay it offline at no API
 * cost. Null if the bundled file is malformed, which hides it in the lobby.
 */
export const JEV_LAP: JevRecording | null = parseJevLap(bundled);

/** `length` finite numbers, time first: five for a frame, six for a decision. */
function isTuple<T extends number[]>(value: unknown, length: T["length"]): value is T {
  return Array.isArray(value) && value.length === length && value.every((n) => Number.isFinite(n));
}

/** The recording, if it has the shape the replay relies on; otherwise null. */
export function parseJevLap(value: unknown): JevRecording | null {
  if (typeof value !== "object" || value === null) return null;
  const { model, timeMs, frames, decisions } = value as Partial<Record<string, unknown>>;
  if (typeof model !== "string" || typeof timeMs !== "number" || !(timeMs > 0)) return null;
  if (!Array.isArray(frames) || frames.length < 2) return null;
  if (!frames.every((f) => isTuple<ReplayFrame>(f, 5))) return null;
  if (!Array.isArray(decisions)) return null;
  if (!decisions.every((d) => isTuple<JevRecordedDecision>(d, 6))) return null;
  return {
    model,
    timeMs,
    frames: frames satisfies ReplayFrame[],
    decisions: decisions satisfies JevRecordedDecision[],
  };
}
