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
  bookingId: string;
  milestone: PaymentMilestone;
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
} as const;
export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];

/** Gateway events this platform reacts to. */
export const GatewayEvent = {
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_PROCESSED: 'refund.processed',
} as const;
export type GatewayEvent = (typeof GatewayEvent)[keyof typeof GatewayEvent];

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
