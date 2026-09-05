import type { Paisa } from './common.js';
import type {
  FunctionType,
  KycStatus,
  PricingModel,
  VendorCategory,
} from './enums.js';

/**
 * The supply side. A vendor lists and builds a portfolio immediately, but KYC
 * gates money: verification is required before a booking can be accepted or a
 * payout made. That split is why `kycStatus` and `isActive` are separate.
 */
export interface VendorDto {
  id: string;
  ownerId: string;
  businessName: string;
  category: VendorCategory;
  city: string;
  description: string;
  kycStatus: KycStatus;
  /** Set when KYC was rejected, so the vendor knows what to fix. */
  kycRejectionReason?: string | null;
  isActive: boolean;
  /** Cheapest service on the catalogue, for search result cards. */
  priceFrom?: Paisa | null;
  rating: number;
  reviewCount: number;
  /** Median minutes to first quote. A ranking input, so vendors can see it. */
  medianResponseMins?: number | null;
  completedBookings: number;
}

export interface OnboardVendorRequest {
  businessName: string;
  category: VendorCategory;
  city: string;
  description: string;
}

/** PAN and bank proof are mandatory; GSTIN only above the turnover threshold. */
export interface SubmitKycRequest {
  pan: string;
  gstin?: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifsc: string;
}

export interface KycDecisionRequest {
  decision: 'VERIFIED' | 'REJECTED';
  /** Required when rejecting - a rejection without a reason is unactionable. */
  reason?: string;
}

/**
 * One sellable package. Nine categories price differently - a venue by the day,
 * a caterer by the plate - so the shape carries its own pricing model rather
 * than forcing every category through one.
 */
export interface VendorServiceDto {
  id: string;
  vendorId: string;
  title: string;
  description: string;
  pricingModel: PricingModel;
  /** Per unit of the pricing model: per day, per plate, per package, per hour. */
  basePrice: Paisa;
  /** Per-plate models only: the minimum billable count. */
  minimumUnits?: number | null;
  /** Venues only. */
  capacity?: number | null;
  inclusions: string[];
  isActive: boolean;
}

export interface UpsertServiceRequest {
  title: string;
  description: string;
  pricingModel: PricingModel;
  basePrice: Paisa;
  minimumUnits?: number;
  capacity?: number;
  inclusions: string[];
}

/**
 * Vendor search. `date` is what makes this more than a directory: a vendor
 * already booked that day is excluded, so the results are bookable rather than
 * merely relevant.
 */
export interface VendorSearchQuery {
  category?: VendorCategory;
  city?: string;
  /** ISO date. Excludes vendors whose calendar is taken that day. */
  date?: string;
  maxPrice?: Paisa;
  minRating?: number;
  sort?: 'rating' | 'price' | 'response';
  page?: number;
  limit?: number;
}

export interface VendorSearchResult extends VendorDto {
  /** Only when the query carried a date. */
  availableOnDate?: boolean | null;
  services: VendorServiceDto[];
}

// ---------------------------------------------------------------------------
// Enquiries - the step between finding a vendor and holding a date
// ---------------------------------------------------------------------------

export const EnquiryVendorStatus = {
  SENT: 'SENT',
  QUOTED: 'QUOTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
} as const;
export type EnquiryVendorStatus =
  (typeof EnquiryVendorStatus)[keyof typeof EnquiryVendorStatus];

/** One vendor's leg of a fanned-out enquiry. */
export interface EnquiryVendorDto {
  vendorId: string;
  businessName: string;
  status: EnquiryVendorStatus;
  quoteId?: string | null;
  respondedAt?: string | null;
}

export interface EnquiryDto {
  id: string;
  weddingId: string;
  customerId: string;
  category: VendorCategory;
  functionType: FunctionType;
  functionDate: string;
  city: string;
  guestCount: number;
  budget?: Paisa | null;
  notes?: string | null;
  vendors: EnquiryVendorDto[];
  /** Vendors have this long to quote before the leg expires. */
  expiresAt: string;
  createdAt: string;
}

/** What a vendor sees in the inbox: one enquiry, their leg of it, and the SLA. */
export interface VendorEnquiryDto {
  id: string;
  category: VendorCategory;
  functionType: FunctionType;
  functionDate: string;
  city: string;
  guestCount: number;
  budget?: Paisa | null;
  notes?: string | null;
  status: EnquiryVendorStatus;
  quoteId?: string | null;
  receivedAt: string;
  expiresAt: string;
  /** Negative once the SLA has been missed. Drives the amber/red inbox. */
  hoursRemaining: number;
}

export interface CreateEnquiryRequest {
  weddingId: string;
  category: VendorCategory;
  functionType: FunctionType;
  functionDate: string;
  guestCount: number;
  budget?: Paisa;
  notes?: string;
  /** Fanned out to each of these. Bounded so this cannot become a broadcast. */
  vendorIds: string[];
}

export interface QuoteLineItemRequest {
  description: string;
  quantity: number;
  unitPrice: Paisa;
}

/**
 * A vendor's response. Totals are absent by design: the server recomputes every
 * line, the subtotal, the GST and the total, so a quote can never claim a sum
 * its own line items do not support.
 */
export interface CreateQuoteRequest {
  lineItems: QuoteLineItemRequest[];
  /** 10-50%, enforced server-side. */
  advancePercent: number;
  /** Days the quote stays valid. */
  validForDays: number;
  notes?: string;
}

export interface CreateWeddingRequest {
  brideName: string;
  groomName: string;
  primaryDate: string;
  city: string;
  guestEstimate: number;
  budgetTotal: Paisa;
}

/** How long a vendor has to answer an enquiry before the leg expires. */
export const ENQUIRY_SLA_HOURS = 24;

/** The most vendors one enquiry may fan out to. */
export const MAX_ENQUIRY_VENDORS = 5;

// ---------------------------------------------------------------------------
// Vendor calendar
// ---------------------------------------------------------------------------

/**
 * One day on a vendor's calendar. HELD and BOOKED come from real bookings and
 * cannot be edited by hand; BLOCKED is the vendor saying they are unavailable.
 */
export interface VendorCalendarDay {
  date: string;
  status: 'HELD' | 'BOOKED' | 'BLOCKED';
  bookingId?: string | null;
  reason?: string | null;
}

export interface BlockDatesRequest {
  /** ISO dates. Blocking a date that already carries a booking is refused. */
  dates: string[];
  reason?: string;
}

export interface CreateWeddingFunctionRequest {
  type: FunctionType;
  date: string;
  guestCount: number;
}
