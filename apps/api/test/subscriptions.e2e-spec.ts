import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { Capability, FREE_DAILY_INTERESTS, PLANS } from '@eventhub/contracts';

import { SubscriptionsModule } from '../src/modules/subscriptions/subscriptions.module.js';
import { EntitlementsService } from '../src/modules/subscriptions/services/entitlements.service.js';
import {
  Subscription,
  type SubscriptionDocument,
} from '../src/modules/subscriptions/schemas/subscription.schema.js';

/**
 * The paywall's own rules, tested without any matrimony code in the way.
 *
 * These are the cases that decide revenue: whether a lapsed plan still works,
 * whether a second purchase adds time or throws it away, and whether the free
 * quota is what the plan table says it is.
 */
describe('Entitlements (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let entitlements: EntitlementsService;
  let subscriptions: Model<SubscriptionDocument>;

  const userId = () => new Types.ObjectId().toString();

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        SubscriptionsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    entitlements = moduleRef.get(EntitlementsService);
    subscriptions = moduleRef.get(getModelToken(Subscription.name));
    await subscriptions.syncIndexes();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await subscriptions.deleteMany({});
  });

  describe('the free tier', () => {
    it('allows interests up to the published limit', async () => {
      const user = userId();

      const first = await entitlements.can(
        user,
        Capability.MATRIMONY_SEND_INTEREST,
        0,
      );
      expect(first.allowed).toBe(true);
      expect(first.limit).toBe(FREE_DAILY_INTERESTS);

      const last = await entitlements.can(
        user,
        Capability.MATRIMONY_SEND_INTEREST,
        FREE_DAILY_INTERESTS - 1,
      );
      expect(last.allowed).toBe(true);
    });

    it('stops at the limit, and says why in words a member can act on', async () => {
      const verdict = await entitlements.can(
        userId(),
        Capability.MATRIMONY_SEND_INTEREST,
        FREE_DAILY_INTERESTS,
      );

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('plan');
    });

    it('grants nothing that is paid for', async () => {
      const user = userId();
      for (const capability of [
        Capability.MATRIMONY_VIEW_CONTACT,
        Capability.MATRIMONY_START_CHAT,
      ]) {
        expect((await entitlements.can(user, capability)).allowed).toBe(false);
      }
    });

    it('reports itself honestly in the snapshot', async () => {
      const snapshot = await entitlements.snapshot(userId(), 2);

      expect(snapshot.plan).toBe('FREE');
      expect(snapshot.isPaid).toBe(false);
      expect(snapshot.subscription).toBeNull();
      expect(snapshot.interests).toEqual({
        used: 2,
        limit: FREE_DAILY_INTERESTS,
        remaining: FREE_DAILY_INTERESTS - 2,
      });
    });
  });

  describe('a paid plan', () => {
    it('lifts the interest limit entirely', async () => {
      const user = userId();
      await entitlements.grant(user, 'MATRIMONY_3M', 'test');

      const verdict = await entitlements.can(
        user,
        Capability.MATRIMONY_SEND_INTEREST,
        500,
      );
      expect(verdict.allowed).toBe(true);
      expect(verdict.limit).toBeNull();
    });

    it('unlocks contact details and chat', async () => {
      const user = userId();
      await entitlements.grant(user, 'MATRIMONY_6M', 'test');

      expect(
        (await entitlements.can(user, Capability.MATRIMONY_VIEW_CONTACT)).allowed,
      ).toBe(true);
      expect(
        (await entitlements.can(user, Capability.MATRIMONY_START_CHAT)).allowed,
      ).toBe(true);
    });

    it('runs for exactly the advertised number of days', async () => {
      const user = userId();
      const granted = await entitlements.grant(user, 'MATRIMONY_12M', 'test');

      const days = Math.round(
        (new Date(granted.currentPeriodEnd).getTime() -
          new Date(granted.startedAt).getTime()) /
          86_400_000,
      );
      expect(days).toBe(PLANS.MATRIMONY_12M.durationDays);
    });

    /**
     * The case that costs money if it is wrong: a lapsed plan must stop
     * working the moment it lapses, without waiting for a sweep to notice.
     */
    it('stops working the moment it expires', async () => {
      const user = userId();
      await entitlements.grant(user, 'MATRIMONY_3M', 'test');

      await subscriptions.updateMany(
        {},
        { $set: { currentPeriodEnd: new Date(Date.now() - 1000) } },
      );

      expect(await entitlements.active(user)).toBeNull();
      expect(
        (await entitlements.can(user, Capability.MATRIMONY_VIEW_CONTACT)).allowed,
      ).toBe(false);

      const verdict = await entitlements.can(
        user,
        Capability.MATRIMONY_SEND_INTEREST,
        FREE_DAILY_INTERESTS,
      );
      // Back to the free floor, not locked out entirely.
      expect(verdict.allowed).toBe(false);
      expect(verdict.limit).toBe(FREE_DAILY_INTERESTS);
    });

    it('adds time rather than discarding what was already paid for', async () => {
      const user = userId();
      const first = await entitlements.grant(user, 'MATRIMONY_3M', 'first');
      const second = await entitlements.grant(user, 'MATRIMONY_3M', 'second');

      const firstEnd = new Date(first.currentPeriodEnd).getTime();
      const secondEnd = new Date(second.currentPeriodEnd).getTime();
      const added = Math.round((secondEnd - firstEnd) / 86_400_000);

      expect(added).toBe(PLANS.MATRIMONY_3M.durationDays);
      // And exactly one row is live, so entitlements cannot double-count.
      expect(await subscriptions.countDocuments({ status: 'ACTIVE' })).toBe(1);
    });

    it('marks a staff grant as complimentary, not paid', async () => {
      const granted = await entitlements.grant(userId(), 'MATRIMONY_3M', 'goodwill');
      expect(granted.source).toBe('COMPLIMENTARY');
    });
  });

  it('offers every plan except the free floor', () => {
    const codes = entitlements.plans().map((p) => p.code);
    expect(codes).not.toContain('FREE');
    expect(codes).toEqual(['MATRIMONY_3M', 'MATRIMONY_6M', 'MATRIMONY_12M']);
    // Nothing is sold without a price and a description.
    for (const plan of entitlements.plans()) {
      expect(plan.price).toBeGreaterThan(0);
      expect(plan.summary.length).toBeGreaterThan(20);
    }
  });
});
