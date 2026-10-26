const MAX_KEYS = 10_000;

/** A fixed-window in-memory counter. Fine for one API process. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Counts one hit; false once the key is over the limit. */
  hit(key: string, now: number = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.delete(key); // re-insert so it counts as the newest entry
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      // Maps iterate in insertion order: the first key is the oldest.
      if (this.hits.size > MAX_KEYS) {
        this.hits.delete(this.hits.keys().next().value!);
      }
      return this.max >= 1;
    }
    cur.count++;
    return cur.count <= this.max;
  }

  /** True while the key is at or over the limit, without counting. */
  blocked(key: string, now: number = Date.now()): boolean {
    const cur = this.hits.get(key);
    return !!cur && cur.resetAt > now && cur.count >= this.max;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export interface RateLimits {
  /** Login attempts per IP (all attempts) and per account+IP (failures only). */
  loginIp: RateLimiter;
  loginAccount: RateLimiter;
  registerIp: RateLimiter;
  /** Reset-token redemptions per IP. */
  resetIp: RateLimiter;
  /** Rename attempts per user. */
  usernameChange: RateLimiter;
}

const MIN = 60_000;

export function defaultRateLimits(): RateLimits {
  return {
    loginIp: new RateLimiter(30, 15 * MIN),
    loginAccount: new RateLimiter(10, 15 * MIN),
    registerIp: new RateLimiter(10, 60 * MIN),
    resetIp: new RateLimiter(20, 15 * MIN),
    usernameChange: new RateLimiter(10, 15 * MIN),
  };
}
