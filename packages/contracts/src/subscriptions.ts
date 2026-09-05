import type { Paisa } from './common.js';

/**
 * What a member is allowed to do.
 *
 * Capabilities exist so the paywall is asked one question in one place -
 * "may this person do this?" - rather than being spread across services as
 * `if (subscribed)` checks that drift apart. Moving the line between free and
 * paid then becomes a change to the plan table below, not a refactor.
 *
 * Only matrimony has capabilities. The events side earns through commission on
 * bookings and is deliberately never gated on a subscription.
 */
export const Capability = {
  /** Send an interest. Free within a daily quota; unlimited on a plan. */
  MATRIMONY_SEND_INTEREST: 'matrimony.interest.send',
  /** See a phone number once interest is mutual. */
  MATRIMONY_VIEW_CONTACT: 'matrimony.contact.view',
  /** Start a conversation. */
  MATRIMONY_START_CHAT: 'matrimony.chat.start',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

export const PlanCode = {
  FREE: 'FREE',
  MATRIMONY_3M: 'MATRIMONY_3M',
  MATRIMONY_6M: 'MATRIMONY_6M',
  MATRIMONY_12M: 'MATRIMONY_12M',
} as const;
export type PlanCode = (typeof PlanCode)[keyof typeof PlanCode];

export interface Plan {
  code: PlanCode;
  name: string;
  /** What a family is actually buying, in their words. */
  summary: string;
  /** Integer paisa, inclusive of nothing - GST is added at checkout. */
  price: Paisa;
  durationDays: number;
  /** Capabilities granted outright. Absent ones fall back to the free limits. */
  grants: Capability[];
  /** Interests per day. Null means unlimited. */
  dailyInterests: number | null;
}

/** Free members may send this many interests a day. */
export const FREE_DAILY_INTERESTS = 5;

/**
 * The plan table.
 *
 * Prices are deliberately round numbers a family can weigh against a wedding
 * budget. The longer plans are cheaper per month because the decision a family
 * is really making is "how long will this take", and the honest answer is
 * usually longer than three months.
 */
export const PLANS: Readonly<Record<PlanCode, Plan>> = {
  FREE: {
    code: 'FREE',
    name: 'Free',
    summary: 'Browse every profile, receive interests, and send five a day.',
    price: 0 as Paisa,
    durationDays: 0,
    grants: [],
    dailyInterests: FREE_DAILY_INTERESTS,
  },
  MATRIMONY_3M: {
    code: 'MATRIMONY_3M',
    name: '3 months',
    summary: 'Unlimited interests, contact details, and chat.',
    price: 1_999_00 as Paisa,
    durationDays: 90,
    grants: [
      Capability.MATRIMONY_SEND_INTEREST,
      Capability.MATRIMONY_VIEW_CONTACT,
      Capability.MATRIMONY_START_CHAT,
    ],
    dailyInterests: null,
  },
  MATRIMONY_6M: {
    code: 'MATRIMONY_6M',
    name: '6 months',
    summary: 'Everything in the 3-month plan, at a lower monthly rate.',
    price: 3_499_00 as Paisa,
    durationDays: 180,
    grants: [
      Capability.MATRIMONY_SEND_INTEREST,
      Capability.MATRIMONY_VIEW_CONTACT,
      Capability.MATRIMONY_START_CHAT,
    ],
    dailyInterests: null,
  },
  MATRIMONY_12M: {
    code: 'MATRIMONY_12M',
    name: '12 months',
    summary: 'A full year, for families who would rather not think about it again.',
    price: 5_999_00 as Paisa,
    durationDays: 365,
    grants: [
      Capability.MATRIMONY_SEND_INTEREST,
      Capability.MATRIMONY_VIEW_CONTACT,
      Capability.MATRIMONY_START_CHAT,
    ],
    dailyInterests: null,
  },
};

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export interface SubscriptionDto {
  id: string;
  plan: PlanCode;
  planName: string;
  status: SubscriptionStatus;
  startedAt: string;
  currentPeriodEnd: string;
  /** Whole days left. Negative once it has lapsed. */
  daysRemaining: number;
  /** COMPLIMENTARY subscriptions are granted by staff, not bought. */
  source: 'PAID' | 'COMPLIMENTARY';
}

/**
 * What the client needs to render the paywall: what the member may do, and how
 * much of the free allowance is left. The server remains the authority - this
 * exists so the UI can prompt before an action fails, not so it can decide.
 */
export interface EntitlementsDto {
  plan: PlanCode;
  planName: string;
  isPaid: boolean;
  subscription?: SubscriptionDto | null;
  capabilities: Capability[];
  interests: {
    used: number;
    /** Null when unlimited. */
    limit: number | null;
    remaining: number | null;
  };
}

export interface GrantSubscriptionRequest {
  userId: string;
  plan: PlanCode;
  reason?: string;
}
