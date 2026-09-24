/** How long a message stays a candidate for the least-delayed one. */
const WINDOW_MS = 5_000;
/** Bounds memory against a sender whose clock runs backwards. */
const MAX_CANDIDATES = 256;

/**
 * Relates a sender's clock to the receiver's from one-way timestamped messages.
 * Each message's `receivedAt − sentAt` is the clock difference plus its transit
 * delay. The smallest over a sliding window is the least-delayed message, so
 * delay spikes and bunched deliveries never leak in, while the window lets the
 * estimate follow clock drift and route changes. What remains is a constant
 * bias, the minimum transit delay, which a fixed interpolation delay absorbs.
 */
export class ClockOffset {
  /** Candidates for the window minimum: in arrival order, offsets strictly rising. */
  private readonly candidates: { at: number; offset: number }[] = [];

  observe(sentAt: number, receivedAt: number): void {
    const offset = receivedAt - sentAt;
    const candidates = this.candidates;
    // A later message at least as fast outlasts an earlier one in the window,
    // so the earlier one can never be the minimum again.
    while (candidates.length > 0 && candidates[candidates.length - 1].offset >= offset) {
      candidates.pop();
    }
    candidates.push({ at: receivedAt, offset });
    while (candidates[0].at <= receivedAt - WINDOW_MS || candidates.length > MAX_CANDIDATES) {
      candidates.shift();
    }
  }

  /**
   * Receiver clock minus sender clock, including the least transit delay; null
   * before any message. A sender timestamp plus this is never after its arrival.
   */
  get offset(): number | null {
    return this.candidates[0]?.offset ?? null;
  }
}
