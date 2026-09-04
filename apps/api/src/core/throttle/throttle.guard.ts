import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ErrorCode } from '@eventhub/contracts';

import type { JwtPayload } from '../decorators.js';

/**
 * Rate limiting.
 *
 * @nestjs/throttler has no NestJS 12 release - its latest (6.5.0) is CommonJS
 * and peers at Nest 11 - so this is a small stand-in with the same decorator
 * ergonomics. The store is swappable: the in-memory one below is correct for a
 * single task, and MUST be replaced with the Redis store before running more
 * than one API task, or each task will enforce its own separate quota.
 */

export interface ThrottleLimit {
  limit: number;
  ttlMs: number;
}

export const THROTTLE_KEY = 'throttle';

/** @Throttle({ limit: 5, ttlMs: 60_000 }) */
export const Throttle = (opts: ThrottleLimit): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_KEY, opts);

export const SKIP_THROTTLE_KEY = 'skipThrottle';
export const SkipThrottle = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_THROTTLE_KEY, true);

export interface ThrottleStore {
  /** Increments the counter for `key` and returns the new count plus reset time. */
  hit(key: string, ttlMs: number): Promise<{ count: number; resetAt: number }>;
}

/** Single-process store. Fine for local development and one ECS task. */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, ttlMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + ttlMs };
      this.buckets.set(key, fresh);
      this.sweep(now);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }

  /** Keeps the map from growing without bound under many distinct keys. */
  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}

export const THROTTLE_STORE = Symbol('THROTTLE_STORE');

const DEFAULT: ThrottleLimit = { limit: 100, ttlMs: 60_000 };
const ANON_DEFAULT: ThrottleLimit = { limit: 20, ttlMs: 60_000 };

@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly store: ThrottleStore = new MemoryThrottleStore();

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: JwtPayload }>();
    const res = http.getResponse<Response>();

    const configured = this.reflector.getAllAndOverride<ThrottleLimit>(THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const rule = configured ?? (req.user ? DEFAULT : ANON_DEFAULT);

    // Keyed on identity where we have one, IP otherwise - so a shared NAT does
    // not let one user exhaust an office's quota, and an anonymous flood is
    // still bounded.
    const identity = req.user?.sub ?? req.ip ?? 'unknown';
    const key = `${context.getClass().name}:${context.getHandler().name}:${identity}`;

    const { count, resetAt } = await this.store.hit(key, rule.ttlMs);
    const remaining = Math.max(0, rule.limit - count);

    res.setHeader('X-RateLimit-Limit', rule.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (count > rule.limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', retryAfter);
      throw new HttpException(
        {
          code: ErrorCode.RATE_LIMITED,
          message: `Too many attempts. Try again in ${retryAfter} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
