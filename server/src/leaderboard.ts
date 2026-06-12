import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeaderboardEntry } from "@racing/shared";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA_DIR, "leaderboard.json");
const MAX_ENTRIES = 50;

function load(): LeaderboardEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let entries: LeaderboardEntry[] = load();

function save(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

/** Record a lap time. Returns true if the leaderboard changed (new or improved entry). */
export function submitTime(name: string, timeMs: number): boolean {
  const existing = entries.find((e) => e.name === name);
  if (existing) {
    if (timeMs >= existing.timeMs) return false;
    existing.timeMs = timeMs;
    existing.date = new Date().toISOString();
  } else {
    entries.push({ name, timeMs, date: new Date().toISOString() });
  }
  entries.sort((a, b) => a.timeMs - b.timeMs);
  entries = entries.slice(0, MAX_ENTRIES);
  save();
  return true;
}

export function topEntries(n = 10): LeaderboardEntry[] {
  return entries.slice(0, n);
}
