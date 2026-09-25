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
import { postgresJevUsage, type JevUsageStore } from "./jev-usage";
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
/**
 * How long to wait before reading an unknown day's usage again: well inside the
 * 20 s a live run waits for progress, so a run opened meanwhile rides out a
 * recovery. One indexed single-row read.
 */
export const JEV_USAGE_RETRY_MS = 5_000;
/** Decisions per UTC day before Jev switches off until the next one (~200 live laps). */
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

/** Refill the bucket for the time since it was last touched; true if it holds a token. */
function refill(bucket: Bucket, now: number, perSecond: number, burst: number): boolean {
  const elapsed = Math.max(0, now - bucket.refilledAt);
  bucket.tokens = Math.min(burst, bucket.tokens + (elapsed * perSecond) / 1000);
  bucket.refilledAt = now;
  return bucket.tokens >= 1;
}

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

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
  /** Decisions counted on `day` but not yet added to the store; a write coalesces them. */
  private unsaved = 0;
  private saving = false;
  /**
   * Set when today's usage could not be read: the budget left is unknown, so no
   * decision is asked for (failing closed) until a read succeeds. Retried at most
   * every JEV_USAGE_RETRY_MS, by the requests that find it unknown.
   */
  private usageUnknownSince: number | null = null;
  /** A read of today's usage is on its way; another would count it twice. */
  private loading = false;
  private lastWarningAt = -Infinity;
  private unreportedFailures = 0;

  constructor(
    private readonly driver: JevDriver | null,
    private readonly dailyDecisions = JEV_DEFAULT_DAILY_DECISIONS,
    private readonly usage: JevUsageStore = postgresJevUsage,
  ) {}

  /** Pick up today's count from the store, so a restart does not refill the daily budget. */
  async load(now = Date.now()): Promise<void> {
    if (!this.driver || this.loading) return;
    this.loading = true;
    const day = utcDay(now);
    try {
      const stored = await this.usage.decisionsOn(day);
      // The store holds every saved decision; only the unsaved ones are on top.
      if (this.day !== day) {
        this.day = day;
        this.unsaved = 0;
      }
      this.decidedToday = stored + this.unsaved;
      this.usageUnknownSince = null;
    } catch (error) {
      this.usageUnknownSince = now;
      console.error("Failed to load Jev's daily usage; Jev waits until it loads:", error);
    } finally {
      this.loading = false;
    }
  }

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
    if (this.usageUnknownSince !== null) {
      if (now - this.usageUnknownSince >= JEV_USAGE_RETRY_MS) {
        this.usageUnknownSince = now;
        void this.load(now);
      }
      // Temporary, unlike a spent budget: a live run keeps asking and carries on once it loads.
      return refuse("rateLimited");
    }
    if (!this.withinDailyBudget(now)) return refuse("disabled");
    // Both buckets must hold a token before either is spent: a connection over its own
    // limit must not drain the server's, nor a full server the connection's.
    const serverHas = refill(
      this.server,
      now,
      JEV_SERVER_RATE_PER_SECOND,
      JEV_SERVER_RATE_PER_SECOND,
    );
    const connectionHas = refill(connection, now, JEV_RATE_PER_SECOND, JEV_BURST);
    if (this.inFlight >= JEV_MAX_IN_FLIGHT || !serverHas || !connectionHas)
      return refuse("rateLimited");
    this.server.tokens -= 1;
    connection.tokens -= 1;
    this.decidedToday++;
    this.unsaved++;
    void this.save();
    void this.decide(this.driver, socket, connection, message, track);
  }

  /** Whether today's budget has a decision left; the count resets at UTC midnight. */
  private withinDailyBudget(now: number): boolean {
    const day = utcDay(now);
    if (day !== this.day) {
      // Yesterday's unsaved decisions still belong to yesterday.
      if (this.unsaved > 0) void this.usage.add(this.day, this.unsaved).catch(() => {});
      this.day = day;
      this.decidedToday = 0;
      this.unsaved = 0;
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

  /** Add the unsaved decisions to the store; decisions counted meanwhile go in the next write. */
  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      while (this.unsaved > 0) {
        const [day, decisions] = [this.day, this.unsaved];
        this.unsaved = 0;
        try {
          await this.usage.add(day, decisions);
        } catch (error) {
          // Keep them for the next write; the in-memory count enforces the budget meanwhile.
          if (day === this.day) this.unsaved += decisions;
          console.error("Failed to save Jev's daily usage:", error);
          return;
        }
      }
    } finally {
      this.saving = false;
    }
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
