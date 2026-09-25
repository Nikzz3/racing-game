import { WebSocket } from "ws";
import {
  getTrack,
  JEV_DECISION_INTERVAL_MS,
  JEV_TRACK,
  type ClientMessage,
  type JevUnavailableReason,
  type Track,
} from "@racing/shared";
import type { JevDriver } from "./jev";
import { send } from "./transport";

// Jev Live Run budget (ADR-0009 invariant 2). A refused request is answered at
// once with jevUnavailable and never queued: a queued decision would be about a
// pose the car has already left.

/** Sustained decisions per second per connection: the recorded Jev Lap's cadence. */
export const JEV_RATE_PER_SECOND = 1000 / JEV_DECISION_INTERVAL_MS;
/** Decisions a connection may ask for back to back after a pause, absorbing pacing jitter. */
export const JEV_BURST = 3;
/** Decisions in flight across every connection. */
export const JEV_MAX_IN_FLIGHT = 24;
/**
 * Sustained decisions per second across every connection, about five live runs
 * at once. Unlike the per-connection cap this bounds the spend however many
 * sockets a client opens: at ~900 input tokens a decision it is at most ~$0.003/min.
 */
export const JEV_SERVER_RATE_PER_SECOND = 20;
/** Decisions per UTC day before Jev switches off until the next one (~300 live laps). */
export const JEV_DEFAULT_DAILY_DECISIONS = 50_000;
/** Deadline for one decision, with no retries: a late answer is about a pose long gone. */
export const JEV_TIMEOUT_MS = 2000;
/** At most one failure warning per interval; the failures in between are counted into it. */
const FAILURE_WARNING_INTERVAL_MS = 60_000;

type JevDrive = Extract<ClientMessage, { type: "jevDrive" }>;

/** Token bucket: requests that may be sent right now, refilled over time. */
interface Bucket {
  tokens: number;
  refilledAt: number;
}

interface Connection extends Bucket {
  /** Aborts the decision in flight; null while none is. */
  inFlight: AbortController | null;
}

/** Refill the bucket for the time since it was last touched, then take a token if one is left. */
function takeToken(bucket: Bucket, now: number, perSecond: number, burst: number): boolean {
  const elapsed = Math.max(0, now - bucket.refilledAt);
  bucket.tokens = Math.min(burst, bucket.tokens + (elapsed * perSecond) / 1000);
  bucket.refilledAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** `JEV_DAILY_DECISIONS` from the environment, or the default when unset or invalid. */
export function jevDailyDecisions(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.JEV_DAILY_DECISIONS);
  return Number.isInteger(value) && value >= 0 && env.JEV_DAILY_DECISIONS?.trim()
    ? value
    : JEV_DEFAULT_DAILY_DECISIONS;
}

const isProbability = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * Answers `jevDrive` requests with Jev's decision on the server, where the
 * TypeSafe key lives. Any connection may ask, in a Room or not: a Jev Live Run
 * is a standalone viewer opened from the Lobby.
 */
export class JevProxy {
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly server: Bucket = { tokens: JEV_SERVER_RATE_PER_SECOND, refilledAt: 0 };
  private inFlight = 0;
  /** Decisions asked for on `day` (a UTC date), against the daily budget. */
  private day = "";
  private decidedToday = 0;
  private lastWarningAt = -Infinity;
  private unreportedFailures = 0;

  constructor(
    private readonly driver: JevDriver | null,
    private readonly dailyDecisions = JEV_DEFAULT_DAILY_DECISIONS,
  ) {}

  /** Whether this server can ask Jev at all; sent to clients in `welcome`. */
  get available(): boolean {
    return this.driver !== null;
  }

  drive(socket: WebSocket, message: JevDrive): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    const refuse = (reason: JevUnavailableReason) =>
      send(socket, { type: "jevUnavailable", seq: message.seq, reason });
    const track = getTrack(message.track);
    if (!this.driver || track?.id !== JEV_TRACK) return refuse("disabled");

    const now = Date.now();
    let connection = this.connections.get(socket);
    if (!connection) {
      connection = { inFlight: null, tokens: JEV_BURST, refilledAt: now };
      this.connections.set(socket, connection);
    }
    if (connection.inFlight) return refuse("busy");
    if (!this.withinDailyBudget(now)) return refuse("disabled");
    // Server-wide caps are checked first so a refusal there costs the connection no token.
    if (
      this.inFlight >= JEV_MAX_IN_FLIGHT ||
      !takeToken(this.server, now, JEV_SERVER_RATE_PER_SECOND, JEV_SERVER_RATE_PER_SECOND) ||
      !takeToken(connection, now, JEV_RATE_PER_SECOND, JEV_BURST)
    )
      return refuse("rateLimited");
    this.decidedToday++;
    void this.decide(this.driver, socket, connection, message, track);
  }

  /** Whether today's budget has a decision left; the count resets at UTC midnight. */
  private withinDailyBudget(now: number): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.decidedToday = 0;
    }
    if (this.decidedToday < this.dailyDecisions) return true;
    if (this.decidedToday === this.dailyDecisions) {
      // Count past the budget once so the warning is logged once a day.
      this.decidedToday++;
      console.warn(
        `Jev's daily budget of ${this.dailyDecisions} decisions is used up until UTC midnight`,
      );
    }
    return false;
  }

  /** Abort the connection's decision in flight; its answer is never sent. */
  disconnect(socket: WebSocket): void {
    this.connections.get(socket)?.inFlight?.abort();
    this.connections.delete(socket);
  }

  private async decide(
    driver: JevDriver,
    socket: WebSocket,
    connection: Connection,
    { seq, x, z, heading, speed }: JevDrive,
    track: Track,
  ): Promise<void> {
    const controller = new AbortController();
    connection.inFlight = controller;
    this.inFlight++;
    try {
      const answer = await driver.decide({ x, z, heading, speed }, track, {
        signal: controller.signal,
        timeoutMs: JEV_TIMEOUT_MS,
        maxRetries: 0,
      });
      if (controller.signal.aborted) return;
      // Typed output guarantees the shape, not the values; never relay a NaN steer.
      const { accelerate, left, pedalConfidence, steerConfidence } = answer;
      if (![accelerate, left, pedalConfidence, steerConfidence].every(isProbability))
        throw new Error(`implausible answer ${JSON.stringify(answer)}`);
      // `send`, not `sendLatest`: the client waits on this seq before asking again.
      send(socket, {
        type: "jevDecision",
        seq,
        accelerate: answer.accelerate,
        left: answer.left,
        pedalConfidence: answer.pedalConfidence,
        steerConfidence: answer.steerConfidence,
        latencyMs: answer.latencyMs,
        model: answer.model,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.warn(error);
      send(socket, { type: "jevUnavailable", seq, reason: "failed" });
    } finally {
      this.inFlight--;
      connection.inFlight = null;
    }
  }

  /** An outage fails every live run at once; one warning a minute is enough to see it. */
  private warn(error: unknown): void {
    this.unreportedFailures++;
    const now = Date.now();
    if (now - this.lastWarningAt < FAILURE_WARNING_INTERVAL_MS) return;
    const others = this.unreportedFailures - 1;
    console.warn(
      `Jev decision failed: ${String(error)}` +
        (others ? ` (and ${others} more since the last warning)` : ""),
    );
    this.lastWarningAt = now;
    this.unreportedFailures = 0;
  }
}
