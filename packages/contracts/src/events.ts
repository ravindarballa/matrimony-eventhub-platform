import type {
  AvailabilityStatus,
  BookingStatus,
  FunctionType,
  VendorCategory,
} from './enums.js';
import type { Paisa } from './common.js';

export interface WeddingDto {
  id: string;
  customerId: string;
  coupleNames: { bride: string; groom: string };
  primaryDate: string;
  city: string;
  guestEstimate: number;
  budgetTotal: Paisa;
  /** Set when the wedding was seeded from a matrimony profile going engaged. */
  sourceProfileId?: string | null;
}

export interface WeddingFunctionDto {
  id: string;
  weddingId: string;
  type: FunctionType;
  date: string;
  guestCount: number;
}

export interface QuoteLineItem {
  description: string;
  quantity: number;
  unitPrice: Paisa;
  /** quantity * unitPrice - recomputed and re-checked server-side. */
  lineTotal: Paisa;
}

export interface QuoteDto {
  id: string;
  enquiryId: string;
  vendorId: string;
  functionDate: string;
  lineItems: QuoteLineItem[];
  subtotal: Paisa;
  gstAmount: Paisa;
  total: Paisa;
  advancePercent: number;
  validUntil: string;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
}

export interface BookingDto {
  id: string;
  weddingId: string;
  functionId?: string | null;
  customerId: string;
  vendorId: string;
  quoteId: string;
  category: VendorCategory;
  status: BookingStatus;
  eventDate: string;
  totalAmount: Paisa;
  paidAmount: Paisa;
  advanceAmount: Paisa;
  /**
   * Snapshotted at confirmation so a later change to platform commission or the
   * refund policy cannot restate an agreement that was already struck.
   */
  commissionBps: number;
  cancellationTiers: CancellationTier[];
  /** What the server says the caller may do next - the UI renders this. */
  allowedTransitions: BookingStatus[];
  statusHistory: BookingStatusChange[];
}

export interface BookingStatusChange {
  from: BookingStatus | null;
  to: BookingStatus;
  at: string;
  by: string;
  reason?: string;
}

export interface CancellationTier {
  /** Applies when daysBefore >= minDaysBefore, taking the highest match. */
  minDaysBefore: number;
  refundPercent: number;
  vendorPercent: number;
  platformPercent: number;
}

/** Platform default policy. A vendor may be more generous, never harsher. */
export const DEFAULT_CANCELLATION_TIERS: readonly CancellationTier[] = [
  { minDaysBefore: 90, refundPercent: 100, vendorPercent: 0, platformPercent: 0 },
  { minDaysBefore: 60, refundPercent: 75, vendorPercent: 20, platformPercent: 5 },
  { minDaysBefore: 30, refundPercent: 50, vendorPercent: 45, platformPercent: 5 },
  { minDaysBefore: 15, refundPercent: 25, vendorPercent: 70, platformPercent: 5 },
  { minDaysBefore: 0, refundPercent: 0, vendorPercent: 95, platformPercent: 5 },
];

export interface RefundPreview {
  bookingId: string;
  daysUntilEvent: number;
  tierApplied: CancellationTier;
  paidAmount: Paisa;
  refundAmount: Paisa;
  vendorRetains: Paisa;
  platformFee: Paisa;
}

export interface AvailabilityDay {
  date: string;
  status: AvailabilityStatus;
  bookingId?: string | null;
}

/**
 * The legal transitions of a booking. This table is the single source of truth,
 * shared so the client can render the right actions without duplicating rules.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, BookingStatus[]>> = {
  ENQUIRY: ['QUOTED', 'EXPIRED'],
  QUOTED: ['ACCEPTED', 'EXPIRED'],
  // Advance unpaid within 48h releases the held slot.
  ACCEPTED: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED: [],
  EXPIRED: [],
  DISPUTED: ['COMPLETED', 'CANCELLED'],
};
