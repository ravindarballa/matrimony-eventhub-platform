import {
  email,
  maxLength,
  minLength,
  pattern,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { INDIAN_MOBILE_REGEX, type Role } from '@eventhub/contracts';

/**
 * Signal Forms schemas.
 *
 * These encode the same rules as the server's class-validator DTOs. The client
 * copy exists for speed of feedback; the server remains the authority, and its
 * error envelope returns `fields` keyed by the same paths used here so a server
 * rejection can be shown inline against the right control.
 */

export interface RegisterModel {
  fullName: string;
  mobile: string;
  intent: Extract<Role, 'SEEKER' | 'CUSTOMER' | 'VENDOR_OWNER'>;
  consent: boolean;
}

export const emptyRegister = (): RegisterModel => ({
  fullName: '',
  mobile: '',
  intent: 'SEEKER',
  consent: false,
});

export const registerSchema = schema<RegisterModel>((p) => {
  required(p.fullName, { message: 'Enter the name as it appears on your ID' });
  minLength(p.fullName, 3, { message: 'Enter the name as it appears on your ID' });

  required(p.mobile, { message: 'We send a one-time code to this number' });
  pattern(p.mobile, INDIAN_MOBILE_REGEX, {
    message: 'Enter a 10-digit Indian mobile number',
  });
  maxLength(p.mobile, 10);

  required(p.intent);

  validate(p.consent, ({ value }) =>
    value() === true
      ? null
      : { kind: 'consent', message: 'Please accept the terms to continue' },
  );
});

export interface LoginModel {
  mobile: string;
  password: string;
}

export const emptyLogin = (): LoginModel => ({ mobile: '', password: '' });

export const loginSchema = schema<LoginModel>((p) => {
  required(p.mobile, { message: 'Enter your mobile number' });
  pattern(p.mobile, INDIAN_MOBILE_REGEX, {
    message: 'Enter a 10-digit Indian mobile number',
  });
  maxLength(p.mobile, 10);

  required(p.password, { message: 'Enter your password' });
  minLength(p.password, 8, { message: 'Passwords are at least 8 characters' });
});

export interface OtpModel {
  code: string;
}

export const otpSchema = schema<OtpModel>((p) => {
  required(p.code, { message: 'Enter the 6-digit code' });
  pattern(p.code, /^\d{6}$/, { message: 'The code is 6 digits' });
  // Length lives here, not as a template maxlength attribute - Signal Forms
  // owns the validation attributes on a [formField] control.
  maxLength(p.code, 6);
});

/** Kept for the profile screens that collect an optional email. */
export const optionalEmailSchema = schema<{ email: string }>((p) => {
  email(p.email, { message: 'Enter a valid email address' });
});
