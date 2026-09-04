import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormField, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { AuthStore } from '../data/auth.store';
import { emptyLogin, loginSchema } from '../data/auth.schemas';
import { landingRouteFor } from '../../../core/guards/auth.guards';
import type { AppError } from '../../../core/models/app-error';

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

      @if (store.isBusy()) { <mat-progress-bar mode="indeterminate" /> }

      <mat-form-field appearance="outline">
        <mat-label>Mobile number</mat-label>
        <span matTextPrefix>+91&nbsp;</span>
        <input matInput [formField]="f.mobile" inputmode="numeric" autocomplete="tel-national" />
        @if (f.mobile().touched() && f.mobile().errors().length) {
          <mat-error>{{ f.mobile().errors()[0].message }}</mat-error>
        }
      </mat-form-field>

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

      @if (serverError(); as err) {
        <p class="err" role="alert">{{ err }}</p>
      }

      <button mat-flat-button type="submit" [disabled]="store.isBusy()">Sign in</button>

      <p class="alt">New here? <a routerLink="/auth/register">Create an account</a></p>
    </form>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 1rem; width: min(420px, 100%); }
    h2 { margin: 0; font-size: 1.5rem; font-weight: 600; }
    .sub { margin: -0.5rem 0 0.5rem; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .err { color: #b3261e; font-size: 0.85rem; margin: 0; }
    .alt { font-size: 0.9rem; text-align: center; margin: 0.5rem 0 0; }
  `,
})
export class LoginPage {
  protected readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly model = signal(emptyLogin());
  protected readonly f = form(this.model, loginSchema);

  protected readonly showPassword = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected onSubmit(): void {
    this.serverError.set(null);

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
            ? 'That mobile number and password do not match.'
            : err.message,
        );
      }
    });
  }
}
