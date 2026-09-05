/** Shared primitives, response envelopes and error codes. */

/**
 * All money on this platform is an integer number of paisa (Rs 1 = 100 paisa).
 * The brand stops a rupee value being assigned to a paisa field by accident.
 * Conversion to a display string happens once, at the UI edge.
 */
export type Paisa = number & { readonly __brand: 'Paisa' };

export const toPaisa = (rupees: number): Paisa =>
  Math.round(rupees * 100) as Paisa;

export const paisaToRupees = (p: Paisa): number => p / 100;

export const formatInr = (p: Paisa): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(p / 100);

/** Every successful response has this shape - the client parses one envelope. */
export interface ApiResponse<T> {
  data: T;
  meta?: PageMeta;
}

export interface PageMeta {
  page?: number;
  limit?: number;
  total?: number;
  cursor?: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  cursor?: string | null;
}

/**
 * `code` is stable and machine-readable, `message` is safe to show a user, and
 * `fields` maps onto Signal Forms field paths for direct inline display.
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    traceId: string;
  };
}

export const ErrorCode = {
  // auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_OTP_INVALID: 'AUTH_OTP_INVALID',
  AUTH_OTP_EXPIRED: 'AUTH_OTP_EXPIRED',
  AUTH_MOBILE_TAKEN: 'AUTH_MOBILE_TAKEN',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_TOKEN_REUSED: 'AUTH_TOKEN_REUSED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',

  // matrimony
  MAT_QUOTA_EXCEEDED: 'MAT_QUOTA_EXCEEDED',
  MAT_PROFILE_PRIVATE: 'MAT_PROFILE_PRIVATE',
  MAT_UNDERAGE: 'MAT_UNDERAGE',
  MAT_HOROSCOPE_INCOMPLETE: 'MAT_HOROSCOPE_INCOMPLETE',
  MAT_PHOTO_REJECTED: 'MAT_PHOTO_REJECTED',
  MAT_DUPLICATE_INTEREST: 'MAT_DUPLICATE_INTEREST',

  // events
  EVT_SLOT_TAKEN: 'EVT_SLOT_TAKEN',
  EVT_QUOTE_EXPIRED: 'EVT_QUOTE_EXPIRED',
  EVT_VENDOR_INACTIVE: 'EVT_VENDOR_INACTIVE',
  EVT_INVALID_TRANSITION: 'EVT_INVALID_TRANSITION',

  // vendor
  VND_KYC_REJECTED: 'VND_KYC_REJECTED',
  VND_NOT_VERIFIED: 'VND_NOT_VERIFIED',
  VND_DATE_HAS_BOOKING: 'VND_DATE_HAS_BOOKING',
  VND_OWNER_ONLY: 'VND_OWNER_ONLY',

  // payments
  PAY_DECLINED: 'PAY_DECLINED',
  PAY_INTENT_EXPIRED: 'PAY_INTENT_EXPIRED',
  PAY_AMOUNT_MISMATCH: 'PAY_AMOUNT_MISMATCH',
  PAY_BAD_SIGNATURE: 'PAY_BAD_SIGNATURE',
  PAY_GATEWAY_ERROR: 'PAY_GATEWAY_ERROR',
  PAY_ALREADY_CAPTURED: 'PAY_ALREADY_CAPTURED',
  PAY_NOTHING_DUE: 'PAY_NOTHING_DUE',
  PAY_NOT_REFUNDABLE: 'PAY_NOT_REFUNDABLE',

  // generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 10 digits, first digit 6-9. The Indian mobile format, used on both sides. */
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/** Platform commission in basis points, by vendor category. */
export const COMMISSION_BPS = {
  VENUE: 800,
  CATERING: 1000,
  PHOTOGRAPHY: 1200,
  DECOR: 1200,
  MAKEUP: 1500,
  MUSIC: 1200,
  PANDIT: 800,
  TRANSPORT: 1000,
  INVITATION: 1500,
} as const;

/** TDS under section 194-O, in basis points. */
export const TDS_BPS = 100;

/** GST on wedding services, in basis points. */
export const GST_BPS = 1800;

/** In-app notification, as the bell and inbox render it. */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  criticality: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreferencesDto {
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
  whatsapp: boolean;
  /** Marketing is opt-in; everything else is opt-out. */
  marketing: boolean;
  quietFromHour: number;
  quietToHour: number;
}

/** What the admin dashboard shows at a glance. */
export interface PlatformMetricsDto {
  users: { total: number; customers: number; vendors: number; seekers: number };
  vendors: { total: number; verified: number; awaitingKyc: number };
  matrimony: { profiles: number; active: number; interestsSent: number };
  bookings: { total: number; confirmed: number; cancelled: number };
  money: {
    /** Gross value of confirmed bookings, in paisa. */
    gmv: Paisa;
    inEscrow: Paisa;
    commissionEarned: Paisa;
    refunded: Paisa;
  };
}

/** A photo waiting on a moderator, with just enough context to judge it. */
export interface PhotoModerationItemDto {
  profileId: string;
  displayName: string;
  photoId: string;
  url: string;
  submittedAt: string;
}
