import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, map, type Observable } from 'rxjs';
import type {
  AuthResponse,
  RegisterRequest,
  RegisterResponse,
  SessionSummary,
  SessionUser,
} from '@eventhub/contracts';

/** Everything the API returns is wrapped in { data, meta }. */
interface Envelope<T> {
  data: T;
}

/** Only present outside production, so local development needs no SMS provider. */
export type RegisterResult = RegisterResponse & { devCode?: string };

/**
 * HTTP only. It knows URLs and nothing about session state - that lives in
 * AuthStore, which is what keeps this mockable and the store testable.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/auth';

  register(dto: RegisterRequest): Observable<RegisterResult> {
    return this.http
      .post<Envelope<RegisterResult>>(`${this.base}/register`, dto)
      .pipe(map((r) => r.data));
  }

  verifyOtp(challengeId: string, code: string): Observable<AuthResponse> {
    return this.http
      .post<Envelope<AuthResponse>>(`${this.base}/verify-otp`, {
        challengeId,
        code,
        purpose: 'REGISTRATION',
      })
      .pipe(map((r) => r.data));
  }

  login(mobile: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<Envelope<AuthResponse>>(`${this.base}/login`, { mobile, password })
      .pipe(map((r) => r.data));
  }

  /**
   * Signs in with a one-time code instead of a password.
   *
   * This is the path that makes the product usable at all for a member who
   * registered and never set a password - which is everyone, since
   * registration only ever verifies a code.
   */
  loginWithOtp(
    mobile: string,
    otpChallengeId: string,
    otpCode: string,
  ): Observable<AuthResponse> {
    return this.http
      .post<Envelope<AuthResponse>>(`${this.base}/login`, {
        mobile,
        otpChallengeId,
        otpCode,
      })
      .pipe(map((r) => r.data));
  }

  /** Sets a first password, or changes an existing one. */
  setPassword(password: string, currentPassword?: string): Observable<unknown> {
    return this.http.post(`${this.base}/password`, {
      password,
      ...(currentPassword ? { currentPassword } : {}),
    });
  }

  /** Promise-shaped, for the login page's two-step code flow. */
  requestLoginOtpOnce(
    mobile: string,
  ): Promise<{ challengeId: string; devCode?: string }> {
    return firstValueFrom(this.requestLoginOtp(mobile));
  }

  requestLoginOtp(mobile: string): Observable<{ challengeId: string; devCode?: string }> {
    return this.http
      .post<Envelope<{ challengeId: string; devCode?: string }>>(
        `${this.base}/login/otp`,
        { mobile },
      )
      .pipe(map((r) => r.data));
  }

  /** Called once at bootstrap to restore a session from the refresh cookie. */
  refresh(): Observable<AuthResponse> {
    return this.http
      .post<Envelope<AuthResponse>>(`${this.base}/refresh`, {})
      .pipe(map((r) => r.data));
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.base}/logout`, {});
  }

  me(): Observable<SessionUser> {
    return this.http.get<Envelope<SessionUser>>(`${this.base}/me`).pipe(map((r) => r.data));
  }

  sessions(): Observable<SessionSummary[]> {
    return this.http
      .get<Envelope<SessionSummary[]>>(`${this.base}/sessions`)
      .pipe(map((r) => r.data));
  }
}
