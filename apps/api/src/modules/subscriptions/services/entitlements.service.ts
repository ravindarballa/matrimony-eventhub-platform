import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  Capability,
  PLANS,
  PlanCode,
  SubscriptionStatus,
  type EntitlementsDto,
  type Plan,
  type SubscriptionDto,
} from '@eventhub/contracts';

import {
  Subscription,
  type SubscriptionDocument,
} from '../schemas/subscription.schema.js';

/** What a capability check answers. */
export interface Verdict {
  allowed: boolean;
  /** Why not, in words a member can act on. */
  reason?: string;
  /** Present for quota-limited capabilities. */
  used?: number;
  limit?: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The one place that decides what a member may do.
 *
 * Every paywalled action asks the same question here rather than testing for a
 * subscription itself. Two things follow from that: moving the line between
 * free and paid is a change to the plan table and nothing else, and there is
 * exactly one implementation to get right - a second copy that forgot to check
 * expiry would hand out a plan somebody stopped paying for.
 *
 * Counting against a quota is the caller's business, because only the caller
 * knows what it is counting. This service says what the limit is and whether a
 * given usage clears it.
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptions: Model<SubscriptionDocument>,
  ) {}

  plans(): Plan[] {
    // The free plan is a floor, not something to sell, so it is not offered.
    return Object.values(PLANS).filter((p) => p.code !== PlanCode.FREE);
  }

  /**
   * The member's live subscription, or null.
   *
   * Expiry is decided by reading the date rather than by a sweep that flips
   * rows to EXPIRED. A sweep that fails to run would silently extend everyone's
   * access, which is the wrong way for that job to fail.
   */
  async active(userId: string): Promise<SubscriptionDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return null;

    return this.subscriptions
      .findOne({
        userId: new Types.ObjectId(userId),
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { $gt: new Date() },
      })
      .sort({ currentPeriodEnd: -1 });
  }

  async planFor(userId: string): Promise<Plan> {
    const subscription = await this.active(userId);
    return PLANS[subscription?.plan ?? PlanCode.FREE];
  }

  /**
   * May this member do this?
   *
   * `usedToday` is passed in by the caller for quota-limited capabilities -
   * sending an interest is the only one today. Anything the plan grants
   * outright short-circuits the quota entirely.
   */
  async can(
    userId: string,
    capability: Capability,
    usedToday = 0,
  ): Promise<Verdict> {
    const plan = await this.planFor(userId);

    if (plan.grants.includes(capability)) {
      return { allowed: true, limit: null };
    }

    if (capability === Capability.MATRIMONY_SEND_INTEREST) {
      const limit = plan.dailyInterests;
      if (limit === null) return { allowed: true, limit: null };

      return usedToday < limit
        ? { allowed: true, used: usedToday, limit }
        : {
            allowed: false,
            used: usedToday,
            limit,
            reason: `You have used all ${limit} interests for today. A plan lifts this limit.`,
          };
    }

    // Anything not granted and not quota-limited is simply not included.
    return {
      allowed: false,
      reason: 'That is included in a paid plan.',
    };
  }

  /** Everything the client needs to render the paywall honestly. */
  async snapshot(userId: string, usedToday = 0): Promise<EntitlementsDto> {
    const subscription = await this.active(userId);
    const plan = PLANS[subscription?.plan ?? PlanCode.FREE];
    const limit = plan.dailyInterests;

    return {
      plan: plan.code,
      planName: plan.name,
      isPaid: plan.code !== PlanCode.FREE,
      subscription: subscription ? this.toDto(subscription) : null,
      capabilities: plan.grants,
      interests: {
        used: usedToday,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - usedToday),
      },
    };
  }

  /**
   * Starts a period.
   *
   * An existing live subscription is extended from its own end date rather than
   * from today, so buying a second plan before the first lapses adds time
   * instead of throwing away what was already paid for.
   */
  async grant(
    userId: string,
    planCode: PlanCode,
    note?: string,
    paymentId?: Types.ObjectId,
  ): Promise<SubscriptionDto> {
    const plan = PLANS[planCode];
    const existing = await this.active(userId);
    const from = existing?.currentPeriodEnd ?? new Date();

    const created = await this.subscriptions.create({
      userId: new Types.ObjectId(userId),
      plan: planCode,
      status: SubscriptionStatus.ACTIVE,
      startedAt: new Date(),
      currentPeriodEnd: new Date(from.getTime() + plan.durationDays * DAY_MS),
      source: paymentId ? 'PAID' : 'COMPLIMENTARY',
      paymentId,
      note,
    });

    // The superseded row is closed, so `active` cannot return two.
    if (existing) {
      existing.status = SubscriptionStatus.CANCELLED;
      existing.note = 'Superseded by a longer period';
      await existing.save();
    }

    this.logger.log(
      `Granted ${planCode} to ${userId} until ${created.currentPeriodEnd.toISOString()}`,
    );
    return this.toDto(created);
  }

  private toDto(doc: SubscriptionDocument): SubscriptionDto {
    return {
      id: doc.id as string,
      plan: doc.plan,
      planName: PLANS[doc.plan].name,
      status: doc.status,
      startedAt: doc.startedAt.toISOString(),
      currentPeriodEnd: doc.currentPeriodEnd.toISOString(),
      daysRemaining: Math.ceil(
        (doc.currentPeriodEnd.getTime() - Date.now()) / DAY_MS,
      ),
      source: doc.source,
    };
  }
}
