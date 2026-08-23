import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplayFrame, Variant } from "@racing/shared";

vi.mock("./db", () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));

import { pool } from "./db";
import { getReplay, makeFrame, submitLap } from "./replay";

const FRAMES: ReplayFrame[] = [makeFrame(0, 0, 0, 0, 0), makeFrame(1000, 5, 5, 0, 10)];

interface RecordedQuery {
  text: string;
  values: unknown[] | undefined;
}

/** Transaction client stub that records every query and accepts the lap insert. */
function makeClient(): { client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, queries };
}

function queryFor(queries: RecordedQuery[], table: string): RecordedQuery {
  const match = queries.find((q) => q.text.includes(`INSERT INTO ${table}`));
  expect(match, `expected an INSERT INTO ${table}`).toBeDefined();
  return match!;
}

describe("submitLap variant persistence", () => {
  let queries: RecordedQuery[];

  beforeEach(() => {
    const made = makeClient();
    queries = made.queries;
    vi.mocked(pool.connect).mockResolvedValue(made.client as never);
  });

  it("snapshots the session's Variant on both best_laps and replays", async () => {
    await submitLap("Ava", "sunset-ridge", "medium", 61_000, FRAMES, "taxi");

    const bestLaps = queryFor(queries, "best_laps");
    expect(bestLaps.text).toContain("variant");
    expect(bestLaps.values).toContain("taxi");

    const replays = queryFor(queries, "replays");
    expect(replays.text).toContain("variant");
    expect(replays.values).toContain("taxi");
  });

  it("re-snapshots the Variant when an improved lap replaces the row", async () => {
    await submitLap("Ava", "sunset-ridge", "medium", 61_000, FRAMES, "taxi");
    expect(queryFor(queries, "best_laps").text).toContain("variant = EXCLUDED.variant");
    expect(queryFor(queries, "replays").text).toContain("variant = EXCLUDED.variant");
  });

  it("writes NULL when the session never declared a Variant", async () => {
    await submitLap("Ava", "sunset-ridge", "medium", 61_000, FRAMES, undefined);
    expect(queryFor(queries, "best_laps").values).toContain(null);
    expect(queryFor(queries, "replays").values).toContain(null);
  });

  it("whitelists the Variant at the write: an invalid value becomes NULL", async () => {
    await submitLap("Ava", "sunset-ridge", "medium", 61_000, FRAMES, "warthog" as Variant);
    const bestLaps = queryFor(queries, "best_laps");
    expect(bestLaps.values).not.toContain("warthog");
    expect(bestLaps.values).toContain(null);
  });
});

describe("getReplay variant round-trip", () => {
  it("returns the stored Variant with the frames", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ time_ms: 61_000, frames: FRAMES, variant: "taxi" }],
    } as never);
    const replay = await getReplay("Ava", "sunset-ridge", "medium");
    expect(replay).toEqual({ timeMs: 61_000, frames: FRAMES, variant: "taxi" });
  });

  it("returns an absent variant for a NULL column (legacy rows)", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ time_ms: 61_000, frames: FRAMES, variant: null }],
    } as never);
    const replay = await getReplay("Ava", "sunset-ridge", "medium");
    expect(replay?.variant).toBeUndefined();
  });

  it("never echoes an unvalidated stored string", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ time_ms: 61_000, frames: FRAMES, variant: "warthog" }],
    } as never);
    const replay = await getReplay("Ava", "sunset-ridge", "medium");
    expect(replay?.variant).toBeUndefined();
  });
});
