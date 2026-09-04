import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormField, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { AuthStore } from '../data/auth.store';
import { otpSchema } from '../data/auth.schemas';
import { landingRouteFor } from '../../../core/guards/auth.guards';
import type { AppError } from '../../../core/models/app-error';

interface VerifyNavState {
  challengeId?: string;
  mobile?: string;
  devCode?: string;
}

@Component({
  selector: 'eh-verify-otp-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <form class="card" (submit)="$event.preventDefault(); onSubmit()">
      <h2>Verify your number</h2>
      <p class="sub">We sent a 6-digit code to +91 {{ mobile() }}.</p>

      @if (store.isBusy()) { <mat-progress-bar mode="indeterminate" /> }

      @if (devCode()) {
        <p class="dev">Development mode — your code is <strong>{{ devCode() }}</strong></p>
      }

      <mat-form-field appearance="outline">
        <mat-label>6-digit code</mat-label>
        <input matInput [formField]="f.code" inputmode="numeric" autocomplete="one-time-code" class="otp" />
        @if (f.code().touched() && f.code().errors().length) {
          <mat-error>{{ f.code().errors()[0].message }}</mat-error>
        }
      </mat-form-field>

      @if (serverError(); as err) {
        <p class="err" role="alert">{{ err }}</p>
      }

      <button mat-flat-button type="submit" [disabled]="store.isBusy()">Verify</button>

      <button mat-button type="button" [disabled]="secondsLeft() > 0" (click)="resend()">
        {{ secondsLeft() > 0 ? 'Resend in ' + secondsLeft() + 's' : 'Resend code' }}
      </button>
    </form>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 1rem; width: min(420px, 100%); }
    h2 { margin: 0; font-size: 1.5rem; font-weight: 600; }
    .sub { margin: -0.5rem 0 0.5rem; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .otp { letter-spacing: 0.5em; font-size: 1.25rem; font-variant-numeric: tabular-nums; }
    .err { color: #b3261e; font-size: 0.85rem; margin: 0; }
    .dev {
      background: #fbf1dc; border-left: 3px solid #c98a16; padding: 0.6rem 0.8rem;
      font-size: 0.85rem; margin: 0; border-radius: 0 4px 4px 0;
    }
  `,
})
export class VerifyOtpPage implements OnDestroy {
  protected readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  // Passed via router state by the register page rather than the URL - a
  // challenge id in a query string would end up in browser history and logs.
  private readonly navState =
    (this.router.getCurrentNavigation()?.extras.state ??
      history.state) as VerifyNavState;

  protected readonly mobile = signal(this.navState.mobile ?? '');
  protected readonly devCode = signal(this.navState.devCode ?? '');
  private readonly challengeId = this.navState.challengeId ?? '';

  protected readonly model = signal({ code: '' });
  protected readonly f = form(this.model, otpSchema);

  protected readonly serverError = signal<string | null>(null);
  private readonly resendAt = signal(Date.now() + 30_000);
  private readonly now = signal(Date.now());

  protected readonly secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.now()) / 1000)),
  );

  private readonly ticker = setInterval(() => this.now.set(Date.now()), 1000);

  ngOnDestroy(): void {
    clearInterval(this.ticker);
  }

  protected onSubmit(): void {
    this.serverError.set(null);

    void submit(this.f, async () => {
      try {
        await this.store.verifyOtp(this.challengeId, this.model().code);
        await this.router.navigateByUrl(landingRouteFor(this.store.roles()));
      } catch (e) {
        const err = e as AppError;
        this.serverError.set(
          err.code === 'AUTH_OTP_EXPIRED'
            ? 'That code has expired. Request a new one.'
            : err.message,
        );
        this.model.set({ code: '' });
      }
    });
  }

  protected resend(): void {
    // Wired to POST /auth/register again in the next iteration; the countdown
    // is what stops the button being hammered in the meantime.
    this.resendAt.set(Date.now() + 30_000);
  }
}
