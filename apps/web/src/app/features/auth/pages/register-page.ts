import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormField, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import { AuthApi } from '../data/auth-api';
import { emptyRegister, registerSchema } from '../data/auth.schemas';
import type { AppError } from '../../../core/models/app-error';

@Component({
  selector: 'eh-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
  ],
  template: `
    <form class="card" (submit)="$event.preventDefault(); onSubmit()">
      <h2>Create your account</h2>
      <p class="sub">We'll send a one-time code to verify your number.</p>

      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

      <mat-form-field appearance="outline">
        <mat-label>Full name</mat-label>
        <input matInput [formField]="f.fullName" autocomplete="name" />
        @if (f.fullName().touched() && f.fullName().errors().length) {
          <mat-error>{{ f.fullName().errors()[0].message }}</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Mobile number</mat-label>
        <span matTextPrefix>+91&nbsp;</span>
        <input matInput [formField]="f.mobile" inputmode="numeric" autocomplete="tel-national" />
        @if (f.mobile().touched() && f.mobile().errors().length) {
          <mat-error>{{ f.mobile().errors()[0].message }}</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>I'm here to</mat-label>
        <mat-select [formField]="f.intent">
          <mat-option value="SEEKER">Find a match</mat-option>
          <mat-option value="CUSTOMER">Plan a wedding</mat-option>
          <mat-option value="VENDOR_OWNER">List my business</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-checkbox [formField]="f.consent">
        I accept the terms and privacy policy
      </mat-checkbox>
      @if (f.consent().touched() && f.consent().errors().length) {
        <p class="err">{{ f.consent().errors()[0].message }}</p>
      }

      @if (serverError(); as err) {
        <p class="err" role="alert">{{ err }}</p>
      }

      <button mat-flat-button type="submit" [disabled]="busy()">
        {{ busy() ? 'Sending code…' : 'Send code' }}
      </button>

      <p class="alt">Already have an account? <a routerLink="/auth/login">Sign in</a></p>
    </form>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 1rem; width: min(420px, 100%); }
    h2 { margin: 0; font-size: 1.5rem; font-weight: 600; }
    .sub { margin: -0.5rem 0 0.5rem; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .err { color: #b3261e; font-size: 0.8rem; margin: 0; }
    .alt { font-size: 0.9rem; text-align: center; margin: 0.5rem 0 0; }
  `,
})
export class RegisterPage {
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);

  protected readonly model = signal(emptyRegister());
  protected readonly f = form(this.model, registerSchema);

  protected readonly busy = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected onSubmit(): void {
    this.serverError.set(null);

    // submit() marks every field touched and runs validation before the action,
    // so a half-filled form shows all its errors at once.
    void submit(this.f, async () => {
      this.busy.set(true);
      try {
        const res = await firstValueFrom(this.api.register(this.model()));
        await this.router.navigate(['/auth/verify'], {
          state: {
            challengeId: res.challengeId,
            mobile: this.model().mobile,
            devCode: res.devCode,
          },
        });
      } catch (e) {
        const err = e as AppError;
        this.serverError.set(err.message);
      } finally {
        this.busy.set(false);
      }
    });
  }
}
