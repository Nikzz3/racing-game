// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as THREE from "three";
import type { ReplayFrame, ServerMessage, Standing } from "@racing/shared";
import { Game } from "./game";
import { Net } from "../net";
import type { Rival } from "./ladder";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof THREE>()),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    shadowMap = {};
    extensions = { has: () => false };
    info = { programs: [] };
    setPixelRatio() {}
    getPixelRatio() {
      return 1;
    }
    setSize() {}
    compile() {}
    render() {}
    forceContextLoss() {}
    dispose() {}
  },
}));
vi.mock("./trackMesh", () => ({ buildTrack() {} }));
// Each Pacer records the frames it was given; jsdom cannot draw the real one's badge.
const loaded = vi.hoisted(() => [] as [name: string, frames: unknown][]);
vi.mock("./pacer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pacer")>()),
  PacerOverlay: class {
    model = {};
    constructor(
      _scene: unknown,
      readonly driverName: string,
    ) {}
    setFrames(frames: unknown) {
      loaded.push([this.driverName, frames]);
    }
    update() {}
    dispose() {}
  },
}));

const ANA: Rival = { name: "Ana", timeMs: 24_440 };
const BEN: Rival = { name: "Ben", timeMs: 24_100 };
const LAP: ServerMessage = {
  type: "lap",
  playerId: "me",
  name: "Me",
  lapTimeMs: 25_000,
  bestLapMs: 25_000,
  laps: 1,
  isPersonalBest: true,
  isTrackRecord: false,
};
const standing = (bestMs: number, rival: Rival | null): Standing[] => [
  { track: "sunset-ridge", difficulty: "medium", bestMs, rival },
];

const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;

let game: Game;
let sent: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", () => 1);
  sent = vi.spyOn(Net.prototype, "send").mockImplementation(() => {});
  game = new Game(document.body, new Net(), "me", "Room", () => {}, "medium", "sunset-ridge");
});
afterEach(() => {
  game.dispose();
  loaded.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("climbs the Rival ladder after laps, ignoring a Replay asked for before a swap", async () => {
  game.setStandings(standing(26_000, ANA));
  expect(document.querySelector(".rival-prompt, .medal-award")).toBeNull();

  game.onMessage(LAP);
  game.setStandings(standing(25_000, ANA));
  expect(document.querySelector(".medal-award-gold")).not.toBeNull();
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyN" }));
  expect(sent).toHaveBeenLastCalledWith({
    type: "getReplay",
    name: "Ana",
    track: "sunset-ridge",
    difficulty: "medium",
  });
  expect(text(".pacer-chip-name")).toBe("Ana");

  game.onMessage(LAP);
  game.setStandings(standing(24_300, BEN));
  expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Ben" }));
  expect(text(".pacer-chip-name")).toBe("Ben");
  expect(text(".toast.record")).toContain("Rival beaten!");

  const stale: ReplayFrame[] = [[0, 0, 0, 0, 0]];
  const fresh: ReplayFrame[] = [[0, 1, 1, 0, 0]];
  game.receiveReplayFrames(stale, undefined, "Ana");
  game.receiveReplayFrames(fresh, undefined, "Ben");
  await vi.waitFor(() => expect(loaded).toEqual([["Ben", fresh]]));
});
