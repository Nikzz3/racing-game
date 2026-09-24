import { ClockOffset } from "@racing/shared";

/** Fastest the clock corrects toward its estimate, as a fraction of elapsed time. */
const SLEW = 0.05;
/** An estimate further off than this is taken at once: the first snapshot, or the server's clock being set. */
const MAX_SLEW_MS = 100;

/**
 * The server's clock as read from here, estimated from each snapshot's `t`
 * against when it was received. It trails the true server time by the least
 * network delay rather than by each snapshot's own, so late or bunched
 * snapshots do not shake it.
 */
export class ServerClock {
  private readonly offset = new ClockOffset();
  private latest = -Infinity;
  private latestLocal = 0;

  observe(serverT: number, localNow: number): void {
    this.offset.observe(serverT, localNow);
  }

  /**
   * Server time at `localNow`; before any snapshot, the local time. When the
   * estimate moves (a faster snapshot arrives, or the fastest leaves the
   * window), the clock runs at most 5% fast or slow until it has caught up, so
   * what is drawn or timed by it never visibly jumps, halts or rewinds.
   */
  now(localNow: number): number {
    const offset = this.offset.offset;
    if (offset === null) return localNow;
    const target = localNow - offset;
    const elapsed = Math.max(localNow - this.latestLocal, 0);
    const free = this.latest + elapsed;
    const error = target - free;
    this.latestLocal = localNow;
    this.latest =
      Math.abs(error) > MAX_SLEW_MS
        ? target
        : free + Math.min(Math.max(error, -SLEW * elapsed), SLEW * elapsed);
    return this.latest;
  }
}
