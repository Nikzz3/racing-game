/**
 * Run async work one job at a time per key, in submission order, while other
 * keys proceed independently. A failing job logs and does not block the queue.
 */
export class SerialQueues {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly label: string) {}

  enqueue(key: string, work: () => Promise<unknown>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const tail: Promise<void> = previous
      .then(work)
      .then(
        () => {},
        (error) => console.error(`${this.label}:`, error),
      )
      .finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    this.tails.set(key, tail);
    return tail;
  }
}
