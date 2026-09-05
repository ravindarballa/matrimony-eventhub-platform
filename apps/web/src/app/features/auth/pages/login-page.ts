import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormField, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { AuthApi } from '../data/auth-api';
import { AuthStore } from '../data/auth.store';
import { emptyLogin, loginSchema } from '../data/auth.schemas';
import { landingRouteFor } from '../../../core/guards/auth.guards';
import type { AppError } from '../../../core/models/app-error';

/**
 * Sign in, by password or by one-time code.
 *
 * The code path is not a convenience - it is the only way in for most accounts.
 * Registration verifies a code and never asks for a password, so a member who
 * signs out has no password to type. Offering only a password box would strand
 * them at the door of their own account.
 */
@Component({
  selector: 'eh-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <form class="card" (submit)="$event.preventDefault(); onSubmit()">
      <h2>Sign in</h2>
      <p class="sub">Welcome back.</p>

      @if (store.isBusy() || busy()) { <mat-progress-bar mode="indeterminate" /> }

      <mat-form-field appearance="outline">
        <mat-label>Mobile number</mat-label>
        <span matTextPrefix>+91&nbsp;</span>
        <input matInput [formField]="f.mobile" inputmode="numeric" autocomplete="tel-national" />
        @if (f.mobile().touched() && f.mobile().errors().length) {
          <mat-error>{{ f.mobile().errors()[0].message }}</mat-error>
        }
      </mat-form-field>

      @if (mode() === 'password') {
        <mat-form-field appearance="outline">
          <mat-label>Password</mat-label>
          <input matInput [formField]="f.password" [type]="showPassword() ? 'text' : 'password'"
                 autocomplete="current-password" />
          <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">
            {{ showPassword() ? '🙈' : '👁' }}
          </button>
          @if (f.password().touched() && f.password().errors().length) {
            <mat-error>{{ f.password().errors()[0].message }}</mat-error>
          }
        </mat-form-field>
      } @else if (challengeId()) {
        <mat-form-field appearance="outline">
          <mat-label>6-digit code</mat-label>
          <input
            matInput
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            [value]="code()"
            (input)="code.set($any($event.target).value)"
          />
        </mat-form-field>

        @if (devCode()) {
          <p class="dev">Development mode — your code is <strong>{{ devCode() }}</strong></p>
        }
      } @else {
        <p class="hint">
          We will send a 6-digit code to your mobile. No password needed.
        </p>
      }

      @if (serverError(); as err) {
        <p class="err" role="alert">{{ err }}</p>
      }

      <button mat-flat-button type="submit" [disabled]="store.isBusy() || busy()">
        {{ submitLabel() }}
      </button>

      <button mat-button type="button" class="switch" (click)="toggleMode()">
        {{ mode() === 'password' ? 'Sign in with a one-time code instead' : 'Use a password instead' }}
      </button>

      <p class="alt">New here? <a routerLink="/auth/register">Create an account</a></p>
    </form>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 1rem; width: min(420px, 100%); }
    h2 { margin: 0; font-size: 1.5rem; font-weight: 600; }
    .sub { margin: -0.5rem 0 0.5rem; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .hint { margin: -0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.85rem; }
    .dev { margin: -0.25rem 0 0; font-size: 0.85rem; color: #8a5a00;
           background: #fbf1dc; border-left: 3px solid #c98a16;
           padding: 0.5rem 0.7rem; border-radius: 0 6px 6px 0; }
    .err { color: #b3261e; font-size: 0.85rem; margin: 0; }
    .switch { font-size: 0.85rem; }
    .alt { font-size: 0.9rem; text-align: center; margin: 0.5rem 0 0; }
  `,
})
export class LoginPage {
  protected readonly store = inject(AuthStore);
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);

  protected readonly model = signal(emptyLogin());
  protected readonly f = form(this.model, loginSchema);

  protected readonly mode = signal<'password' | 'otp'>('password');
  protected readonly showPassword = signal(false);
  protected readonly serverError = signal<string | null>(null);

  /** Set once a code has been requested; until then the button sends one. */
  protected readonly challengeId = signal<string | null>(null);
  protected readonly devCode = signal<string | null>(null);
  protected readonly code = signal('');
  protected readonly busy = signal(false);

  protected submitLabel(): string {
    if (this.mode() === 'password') return 'Sign in';
    return this.challengeId() ? 'Verify and sign in' : 'Send me a code';
  }

  protected toggleMode(): void {
    this.serverError.set(null);
    this.challengeId.set(null);
    this.devCode.set(null);
    this.code.set('');
    this.mode.update((m) => (m === 'password' ? 'otp' : 'password'));
  }

  protected onSubmit(): void {
    this.serverError.set(null);
    return this.mode() === 'password' ? this.submitPassword() : void this.submitOtp();
  }

  private submitPassword(): void {
    void submit(this.f, async () => {
      const { mobile, password } = this.model();
      try {
        await this.store.loginWithPassword(mobile, password);
        await this.router.navigateByUrl(landingRouteFor(this.store.roles()));
      } catch (e) {
        const err = e as AppError;
        // Deliberately not field-specific: saying which half was wrong would
        // let an attacker enumerate registered numbers.
        this.serverError.set(
          err.code === 'AUTH_INVALID_CREDENTIALS'
            ? 'That mobile number and password do not match. If you have never set a password, use a one-time code.'
            : err.message,
        );
      }
    });
  }

  /** Two steps behind one button: request the code, then verify it. */
  private async submitOtp(): Promise<void> {
    const mobile = this.model().mobile;
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      this.serverError.set('Enter a 10-digit Indian mobile number.');
      return;
    }

    this.busy.set(true);
    try {
      if (!this.challengeId()) {
        const { challengeId, devCode } = await this.api.requestLoginOtpOnce(mobile);
        this.challengeId.set(challengeId);
        this.devCode.set(devCode ?? null);
        return;
      }

      await this.store.loginWithOtp(mobile, this.challengeId()!, this.code());
      await this.router.navigateByUrl(landingRouteFor(this.store.roles()));
    } catch (e) {
      const err = e as AppError;
      this.serverError.set(
        err.code === 'AUTH_OTP_INVALID'
          ? 'That code is not right. Check it and try again.'
          : err.code === 'AUTH_OTP_EXPIRED'
            ? 'That code has expired. Request a new one.'
            : err.message,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
