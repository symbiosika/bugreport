/** Simple in-memory sliding-window rate limiter (per process). */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private maxPerWindow: number,
    private windowMs: number = 60 * 60 * 1000,
  ) {}

  /** Returns true if the call is allowed and records it. */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.maxPerWindow) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
}
