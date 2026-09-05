import type { Paisa } from './common.js';
import type {
  PaymentMilestone,
  PaymentStatus,
  VendorCategory,
} from './enums.js';

export interface CreateIntentRequest {
  bookingId: string;
  milestone: PaymentMilestone;
}

/**
 * What the client needs to open the gateway checkout. The amount is computed
 * server-side from the booking - a client-supplied amount is never accepted.
 */
export interface PaymentIntentDto {
  paymentId: string;
  gatewayOrderId: string;
  /** Publishable key. The secret never leaves the server. */
  gatewayKeyId: string;
  amount: Paisa;
  currency: 'INR';
  milestone: PaymentMilestone;
  bookingId: string;
  expiresAt: string;
}

export interface PaymentDto {
  id: string;
  /** What this payment bought. A subscription has no booking behind it. */
  purpose: 'BOOKING' | 'SUBSCRIPTION';
  bookingId?: string | null;
  milestone?: PaymentMilestone | null;
  planCode?: string | null;
  amount: Paisa;
  status: PaymentStatus;
  method?: string | null;
  paidAt?: string | null;
  failureReason?: string | null;
}

export interface PaymentScheduleEntry {
  milestone: PaymentMilestone;
  amount: Paisa;
  dueDate: string;
  status: PaymentStatus | 'NOT_DUE';
  paymentId?: string | null;
}

/**
 * How one captured payment divides. The three parts always sum to `gross` -
 * vendorNet absorbs the rounding remainder so no paisa is created or lost.
 */
export interface PaymentSplit {
  gross: Paisa;
  commission: Paisa;
  tds: Paisa;
  vendorNet: Paisa;
}

export interface LedgerEntryDto {
  id: string;
  account: LedgerAccount;
  debit: Paisa;
  credit: Paisa;
  refType: string;
  refId: string;
  description: string;
  createdAt: string;
}

/**
 * Double-entry accounts. Every captured payment writes a balanced set, so the
 * ledger can be summed to reconcile against gateway settlements.
 */
export const LedgerAccount = {
  /** Money held by the platform between capture and payout. */
  ESCROW: 'ESCROW',
  /** What the platform has earned in commission. */
  COMMISSION_INCOME: 'COMMISSION_INCOME',
  /** Tax withheld under section 194-O, owed to the government. */
  TDS_PAYABLE: 'TDS_PAYABLE',
  /** What is owed to a vendor but not yet paid out. */
  VENDOR_PAYABLE: 'VENDOR_PAYABLE',
  /** What has been refunded to customers. */
  CUSTOMER_REFUND: 'CUSTOMER_REFUND',

  /**
   * Money the platform has actually earned and keeps, as opposed to escrow,
   * which is held on behalf of a vendor. Subscription revenue lands here.
   * Mixing the two would make escrow impossible to reconcile against gateway
   * settlements, because the balance would include money nobody is owed.
   */
  PLATFORM_CASH: 'PLATFORM_CASH',
  /** Subscription revenue, net of tax. */
  SUBSCRIPTION_INCOME: 'SUBSCRIPTION_INCOME',
  /** GST collected on subscriptions, owed to the government. */
  GST_PAYABLE: 'GST_PAYABLE',
} as const;
export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];

/** Gateway events this platform reacts to. */
export const GatewayEvent = {
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_PROCESSED: 'refund.processed',
} as const;
export type GatewayEvent = (typeof GatewayEvent)[keyof typeof GatewayEvent];

/**
 * What a subscription purchase costs, broken out.
 *
 * The plan price is exclusive of tax and GST is added on top, so the member
 * sees one number to pay and the books keep the platform's share separate from
 * the government's.
 */
export interface SubscriptionQuote {
  planCode: string;
  planName: string;
  /** The plan price, before tax. */
  net: Paisa;
  /** GST at 18%, which is not ours to keep. */
  gst: Paisa;
  /** What is actually charged. */
  gross: Paisa;
  durationDays: number;
}

export interface SubscriptionIntentDto {
  paymentId: string;
  gatewayOrderId: string;
  gatewayKeyId: string;
  currency: 'INR';
  quote: SubscriptionQuote;
  expiresAt: string;
}

export interface CommissionBreakdown {
  category: VendorCategory;
  commissionBps: number;
  tdsBps: number;
}

export interface RefundRequest {
  /** Omitted means the full remaining captured amount. */
  amount?: Paisa;
  reason?: string;
}

export interface RefundDto {
  paymentId: string;
  refundId: string;
  amount: Paisa;
  status: 'processed' | 'pending' | 'failed';
}

/**
 * What the webhook endpoint returns. The gateway only cares that it got a 2xx;
 * `duplicate` is for our own logs when a delivery is retried.
 */
export interface WebhookAck {
  received: true;
  duplicate?: boolean;
}
