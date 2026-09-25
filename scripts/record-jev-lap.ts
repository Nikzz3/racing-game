/**
 * Records the Jev Lap (ADR-0009): Jev drives one lap of Sunset Ridge at Medium
 * headlessly against the real CarPhysics, deciding every 100 ms of game time,
 * and the lap's frames and every decision Jev made are written to
 * client/src/game/jev-lap.json, which the client bundles. Re-record after
 * changing the physics tuning or JEV_QUESTIONS.
 *
 * Usage: npm run jev:record   (TYPESAFE_API_KEY from .env; about 2 min and $0.015)
 *        JEV_STUB=1 npm run jev:record   (dry run with the stand-in; writes nothing)
 */
import "../server/src/env.ts";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  JEV_DECISION_INTERVAL_MS,
  JEV_DIFFICULTY,
  JEV_TRACK,
  jevInput,
  resolveTrack,
  type JevPose,
  type ReplayFrame,
} from "@racing/shared";
import { lapFrames, runDecidedLap } from "../client/src/game/harness.ts";
import type { JevRecordedDecision, JevRecording } from "../client/src/game/jev-recording.ts";
import { createJevDriver, type JevAnswer } from "../server/src/jev.ts";

const OUTPUT = fileURLToPath(new URL("../client/src/game/jev-lap.json", import.meta.url));
const STEP_MS = 1000 / 60;
/** Ninety seconds of game time; a clean lap and its run-up take about forty. */
const MAX_STEPS = 90 * 60;
/** The lap waits for every answer, so a slow one costs only wall-clock time. */
const REQUEST = { timeoutMs: 30_000, maxRetries: 4 };
/** Attempts per decision on top of the SDK's retries, with a growing pause between them. */
const ATTEMPTS = 5;
const LOG_EVERY_MS = 5_000;

const driver = createJevDriver();
if (!driver) {
  console.error("Set TYPESAFE_API_KEY (see .env.example) to record the Jev Lap.");
  process.exit(1);
}
const track = resolveTrack(JEV_TRACK);
const models = new Set<string>();
const started = performance.now();
let asked = 0;
let lastLog = -Infinity;

/** One decision, retried so a single flaky request cannot end a two-minute recording. */
const ask = async (pose: JevPose): Promise<JevAnswer> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await driver.decide(pose, track, REQUEST);
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      const pauseMs = 2_000 * attempt;
      console.warn(
        `Jev request failed (attempt ${attempt}/${ATTEMPTS}), retrying in ${pauseMs / 1000} s: ${String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

console.log(
  `Recording the Jev Lap with the ${driver.kind} driver on ${track.name}, ${JEV_DIFFICULTY}…`,
);
const lap = await runDecidedLap(
  async (pose, { step, nextCheckpoint }) => {
    const answer = await ask(pose);
    asked++;
    models.add(answer.model);
    const now = performance.now();
    if (now - lastLog >= LOG_EVERY_MS) {
      lastLog = now;
      console.log(
        `game ${seconds(step * STEP_MS)} · next checkpoint ${nextCheckpoint}/${track.checkpoints.length} · ` +
          `${Math.round(pose.speed * 3.6)} km/h · ${asked} decisions · ${seconds(now - started)} elapsed`,
      );
    }
    return { ...jevInput(answer), answer };
  },
  {
    decideEverySteps: Math.round(JEV_DECISION_INTERVAL_MS / STEP_MS),
    difficulty: JEV_DIFFICULTY,
    maxSteps: MAX_STEPS,
    track,
  },
);

if (!lap) {
  console.error(
    `Jev did not finish a lap within ${seconds(MAX_STEPS * STEP_MS)} of game time ` +
      `(${asked} decisions); nothing written.`,
  );
  process.exit(1);
}

const round = (n: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};
// Frames and decisions share one clock, so rounding both the same way keeps
// every decision on the frame it judged.
const recording: JevRecording & { recordedAt: string } = {
  model: [...models].join(", "),
  recordedAt: new Date().toISOString(),
  timeMs: round(lap.lapTimeMs, 2),
  frames: lapFrames(lap).map<ReplayFrame>(([t, x, z, heading, speed]) => [
    round(t, 2),
    x,
    z,
    heading,
    speed,
  ]),
  decisions: lap.decisions.map<JevRecordedDecision>(({ timeMs, decision: { answer } }) => [
    round(timeMs, 2),
    round(answer.accelerate, 3),
    round(answer.left, 3),
    round(answer.pedalConfidence, 2),
    round(answer.steerConfidence, 2),
  ]),
};
const json = `${JSON.stringify(recording)}\n`;
const summary =
  `lap ${seconds(lap.lapTimeMs)}, ${recording.decisions.length} decisions in the lap ` +
  `(${asked} asked), ${recording.model}, ${seconds(performance.now() - started)} elapsed`;
if (driver.kind === "stub") {
  console.log(`Dry run with the stub: ${summary}; nothing written.`);
} else {
  writeFileSync(OUTPUT, json);
  console.log(`Wrote ${OUTPUT} (${Math.round(json.length / 1024)} KB): ${summary}.`);
}
