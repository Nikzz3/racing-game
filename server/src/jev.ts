import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  JEV_QUESTIONS,
  jevDrivingState,
  nearestCenterline,
  type JevDecision,
  type JevPose,
  type Track,
} from "@racing/shared";

/** One answered decision, with how long TypeSafe took and which model answered. */
export interface JevAnswer extends JevDecision {
  latencyMs: number;
  model: string;
}

export interface JevRequestOptions {
  signal?: AbortSignal;
  /** Per-attempt timeout; a live run prefers a fast failure over a stale answer. */
  timeoutMs?: number;
  maxRetries?: number;
}

/** Asks Jev (or a stand-in) how to drive from one pose; see ADR-0009. */
export interface JevDriver {
  readonly kind: "typesafe" | "stub";
  decide(pose: JevPose, track: Track, options?: JevRequestOptions): Promise<JevAnswer>;
}

/** The slice of TypeSafeClient the driver uses, so tests can pass a fake. */
export type SystemOneClient = Pick<TypeSafeClient, "systemOne">;

/** The real driver: both questions go out in one request and are answered in parallel. */
export function createTypeSafeJevDriver(client: SystemOneClient): JevDriver {
  return {
    kind: "typesafe",
    async decide(pose, track, { signal, timeoutMs, maxRetries } = {}) {
      const started = performance.now();
      const result = await client.systemOne(
        { state: { ...jevDrivingState(pose, track) }, questions: JEV_QUESTIONS },
        {
          signal,
          timeout: timeoutMs,
          ...(maxRetries !== undefined && { retry: { maxRetries } }),
        },
      );
      return {
        accelerate: result.answers.pedal.probabilities.accelerate,
        left: result.answers.steer.probabilities.left,
        pedalConfidence: result.answers.pedal.confidence,
        steerConfidence: result.answers.steer.confidence,
        latencyMs: Math.round(performance.now() - started),
        model: result.model,
      };
    },
  };
}

const STUB_AIM_METRES = 20;
const STUB_CRUISE_MS = 30;

/**
 * A deterministic, network-free stand-in for e2e and local runs without a key
 * (`JEV_STUB=1`): steers at the road centre a little ahead and cruises at a
 * modest speed. It answers in the same probability shape as Jev.
 */
export function createStubJevDriver(): JevDriver {
  return {
    kind: "stub",
    decide(pose, track) {
      const { samples } = track;
      const { index } = nearestCenterline(pose.x, pose.z, samples);
      const target = samples[(index + Math.round(STUB_AIM_METRES / 3.3)) % samples.length];
      let bearing = Math.atan2(target.x - pose.x, target.z - pose.z) - pose.heading;
      bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
      const accelerate = pose.speed < STUB_CRUISE_MS ? 0.9 : 0.2;
      const left = Math.max(0, Math.min(1, 0.5 + bearing * 2));
      return Promise.resolve({
        accelerate,
        left,
        pedalConfidence: Math.abs(2 * accelerate - 1),
        steerConfidence: Math.abs(2 * left - 1),
        latencyMs: 0,
        model: "stub",
      });
    },
  };
}

/**
 * `JEV_STUB=1` selects the stub; otherwise `TYPESAFE_API_KEY` enables the real
 * driver. With neither, Jev is unavailable and the server says so in `welcome`.
 */
export function createJevDriver(env: NodeJS.ProcessEnv = process.env): JevDriver | null {
  if (env.JEV_STUB === "1") return createStubJevDriver();
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return null;
  return createTypeSafeJevDriver(new TypeSafeClient({ apiKey }));
}
