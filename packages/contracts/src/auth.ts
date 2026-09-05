import type { Role, UserStatus, OtpPurpose } from './enums.js';

/** The user object embedded in an auth response. Never carries the password hash. */
export interface SessionUser {
  id: string;
  fullName: string;
  mobile: string;
  email?: string | null;
  roles: Role[];
  status: UserStatus;
  vendor?: {
    id: string;
    businessName: string;
    kycStatus: string;
  } | null;
  /**
   * Whether this account can sign in with a password at all.
   *
   * Registration verifies a one-time code and never asks for one, so a new
   * account has no password until it sets one. The client needs to know, or it
   * shows a returning member a password box they can never satisfy.
   */
  hasPassword: boolean;
}

export interface RegisterRequest {
  fullName: string;
  mobile: string;
  /** Which role the user is signing up to use first. */
  intent: Extract<Role, 'SEEKER' | 'CUSTOMER' | 'VENDOR_OWNER'>;
  consent: boolean;
}

export interface RegisterResponse {
  challengeId: string;
  /** Seconds until a resend is permitted. Never contains the OTP itself. */
  resendAfterSec: number;
}

export interface VerifyOtpRequest {
  challengeId: string;
  code: string;
  purpose: OtpPurpose;
}

export interface LoginRequest {
  mobile: string;
  /** Exactly one of these is supplied. */
  password?: string;
  otpChallengeId?: string;
  otpCode?: string;
}

/**
 * The access token is returned in the body and held in memory only.
 * The refresh token is set as an httpOnly cookie and never appears here.
 */
export interface AuthResponse {
  user: SessionUser;
  accessToken: string;
  expiresInSec: number;
}

export interface SessionSummary {
  id: string;
  device: string;
  ip: string;
  city?: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export interface AddRoleRequest {
  role: Extract<Role, 'SEEKER' | 'CUSTOMER'>;
}

export interface MobileAvailableResponse {
  available: boolean;
}
