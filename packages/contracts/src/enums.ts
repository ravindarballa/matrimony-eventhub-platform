/**
 * Shared enums. Defined once, imported by both apps through the `@contracts`
 * path alias, so renaming a value is a compile error on the client rather than
 * a runtime surprise.
 */

export const Role = {
  SEEKER: 'SEEKER',
  CUSTOMER: 'CUSTOMER',
  VENDOR_OWNER: 'VENDOR_OWNER',
  VENDOR_STAFF: 'VENDOR_STAFF',
  SUPPORT: 'SUPPORT',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const OtpPurpose = {
  REGISTRATION: 'REGISTRATION',
  LOGIN: 'LOGIN',
  PASSWORD_RESET: 'PASSWORD_RESET',
  MOBILE_CHANGE: 'MOBILE_CHANGE',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

export const ProfileStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  HIDDEN: 'HIDDEN',
  ENGAGED: 'ENGAGED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type ProfileStatus = (typeof ProfileStatus)[keyof typeof ProfileStatus];

export const InterestStatus = {
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type InterestStatus = (typeof InterestStatus)[keyof typeof InterestStatus];

export const PhotoPrivacy = {
  PUBLIC: 'PUBLIC',
  MEMBERS_ONLY: 'MEMBERS_ONLY',
  ON_REQUEST: 'ON_REQUEST',
  BLURRED_UNTIL_MUTUAL: 'BLURRED_UNTIL_MUTUAL',
} as const;
export type PhotoPrivacy = (typeof PhotoPrivacy)[keyof typeof PhotoPrivacy];

export const VendorCategory = {
  VENUE: 'VENUE',
  CATERING: 'CATERING',
  PHOTOGRAPHY: 'PHOTOGRAPHY',
  DECOR: 'DECOR',
  MAKEUP: 'MAKEUP',
  MUSIC: 'MUSIC',
  PANDIT: 'PANDIT',
  TRANSPORT: 'TRANSPORT',
  INVITATION: 'INVITATION',
} as const;
export type VendorCategory = (typeof VendorCategory)[keyof typeof VendorCategory];

export const KycStatus = {
  NOT_STARTED: 'NOT_STARTED',
  SUBMITTED: 'SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type KycStatus = (typeof KycStatus)[keyof typeof KycStatus];

export const PricingModel = {
  PER_DAY: 'PER_DAY',
  PER_PLATE: 'PER_PLATE',
  PER_PACKAGE: 'PER_PACKAGE',
  PER_HOUR: 'PER_HOUR',
} as const;
export type PricingModel = (typeof PricingModel)[keyof typeof PricingModel];

export const FunctionType = {
  ENGAGEMENT: 'ENGAGEMENT',
  MEHENDI: 'MEHENDI',
  HALDI: 'HALDI',
  SANGEET: 'SANGEET',
  WEDDING: 'WEDDING',
  RECEPTION: 'RECEPTION',
} as const;
export type FunctionType = (typeof FunctionType)[keyof typeof FunctionType];

/** Booking lifecycle. Transitions are owned solely by the server state machine. */
export const BookingStatus = {
  ENQUIRY: 'ENQUIRY',
  QUOTED: 'QUOTED',
  ACCEPTED: 'ACCEPTED',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  DISPUTED: 'DISPUTED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/** Statuses that occupy a vendor date and therefore hold an availability slot. */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

export const AvailabilityStatus = {
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  BOOKED: 'BOOKED',
  BLOCKED: 'BLOCKED',
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMilestone = {
  ADVANCE: 'ADVANCE',
  BALANCE: 'BALANCE',
  INSTALMENT: 'INSTALMENT',
} as const;
export type PaymentMilestone = (typeof PaymentMilestone)[keyof typeof PaymentMilestone];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  PUSH: 'PUSH',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

/**
 * TRANSACTIONAL messages bypass quiet hours and marketing opt-outs - a user
 * cannot opt out of a payment failure notice.
 */
export const NotificationCriticality = {
  TRANSACTIONAL: 'TRANSACTIONAL',
  STANDARD: 'STANDARD',
  MARKETING: 'MARKETING',
} as const;
export type NotificationCriticality =
  (typeof NotificationCriticality)[keyof typeof NotificationCriticality];
