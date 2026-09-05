import { Logger } from '@nestjs/common';
// ioredis ships CommonJS, so under nodenext the class is the default export of
// the namespace rather than the namespace itself.
import pkg from 'ioredis';
const Redis = pkg.default ?? pkg;
type RedisClient = InstanceType<typeof Redis>;

import type { ThrottleStore } from './throttle.guard.js';

/**
 * The rate-limit store that works across more than one API task.
 *
 * The in-memory store is correct for a single process and wrong the moment a
 * second one starts: each task would enforce its own separate quota, so five
 * tasks means five times the intended limit, and the OTP endpoint stops being
 * meaningfully limited at all.
 *
 * The increment and the expiry are one round trip and one atomic unit. Doing
 * them as two commands leaves a window where a crash between them produces a
 * key with no TTL - a counter that never resets, which locks a user out
 * permanently rather than for a minute.
 */
export class RedisThrottleStore implements ThrottleStore {
  private readonly logger = new Logger(RedisThrottleStore.name);

  /**
   * Returns the new count and the millisecond TTL, setting the expiry only on
   * the first hit so a sliding window does not extend itself forever.
   */
  private static readonly SCRIPT = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    return { count, redis.call('PTTL', KEYS[1]) }
  `;

  constructor(private readonly redis: RedisClient) {}

  static fromUrl(host: string, port: number): RedisThrottleStore {
    const redis = new Redis({
      host,
      port,
      // Fail fast rather than queueing requests behind a dead connection: the
      // guard falls back to allowing traffic, which is the right call when the
      // alternative is refusing every request because Redis is down.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    void redis.connect().catch(() => {
      // Logged by the guard on first use; not fatal at construction.
    });
    return new RedisThrottleStore(redis);
  }

  async hit(
    key: string,
    ttlMs: number,
  ): Promise<{ count: number; resetAt: number }> {
    try {
      const [count, pttl] = (await this.redis.eval(
        RedisThrottleStore.SCRIPT,
        1,
        key,
        String(ttlMs),
      )) as [number, number];

      return {
        count,
        resetAt: Date.now() + (pttl > 0 ? pttl : ttlMs),
      };
    } catch (e) {
      // Failing open is deliberate. A rate limiter that rejects everything when
      // its store is unreachable turns a Redis blip into a full outage.
      this.logger.error(
        `Rate limit store unavailable, allowing request: ${(e as Error).message}`,
      );
      return { count: 0, resetAt: Date.now() + ttlMs };
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
