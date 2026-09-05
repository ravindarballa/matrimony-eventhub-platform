import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { FormField, form, submit } from '@angular/forms/signals';
import { minLength, pattern, required, schema, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { SessionSummary } from '@eventhub/contracts';

import { AuthStore } from '../../auth/data/auth.store';
import type { AppError } from '../../../core/models/app-error';

interface Envelope<T> {
  data: T;
}

interface PasswordModel {
  currentPassword: string;
  password: string;
  confirm: string;
}

/**
 * Mirrors the server's SetPasswordDto. The server stays the authority - it
 * alone can see whether a password already exists, and it refuses a change
 * without the current one.
 */
const passwordSchema = schema<PasswordModel>((p) => {
  required(p.password, { message: 'Choose a password' });
  minLength(p.password, 8, { message: 'Use at least 8 characters' });
  pattern(p.password, /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Include an uppercase letter, a lowercase letter and a number',
  });

  validate(p.confirm, ({ value, valueOf }) =>
    value() === valueOf(p.password)
      ? null
      : { kind: 'mismatch', message: 'The two passwords do not match' },
  );
});

/**
 * Account settings.
 *
 * The password panel changes shape depending on whether one exists yet, because
 * most accounts have none: registration verifies a one-time code and never asks
 * for a password. Someone who signs out and comes back is stranded unless they
 * either set one here or sign in with a code.
 */
@Component({
  selector: 'eh-account-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <main class="wrap">
      <header>
        <h1>Your account</h1>
        @if (store.user(); as user) {
          <p class="sub">
            {{ user.fullName }} · +91 {{ user.mobile }} ·
            {{ user.roles.join(', ').toLowerCase() }}
          </p>
        }
      </header>

      <section class="panel">
        <h2>Password</h2>

        @if (!store.hasPassword()) {
          <p class="notice">
            <strong>You have no password yet.</strong>
            You registered with a one-time code, so signing in still works that
            way. Set a password here if you would rather not wait for a code
            every time.
          </p>
        }

        @if (done()) {
          <p class="ok" role="status">
            Password saved. Every other session was signed out — including any on
            your other devices.
          </p>
        }

        <form (submit)="$event.preventDefault(); save()">
          @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

          @if (store.hasPassword()) {
            <mat-form-field appearance="outline">
              <mat-label>Current password</mat-label>
              <input matInput type="password" [formField]="f.currentPassword"
                     autocomplete="current-password" />
            </mat-form-field>
          }

          <mat-form-field appearance="outline">
            <mat-label>{{ store.hasPassword() ? 'New password' : 'Password' }}</mat-label>
            <input matInput type="password" [formField]="f.password"
                   autocomplete="new-password" />
            @if (f.password().touched() && f.password().errors().length) {
              <mat-error>{{ f.password().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Confirm</mat-label>
            <input matInput type="password" [formField]="f.confirm"
                   autocomplete="new-password" />
            @if (f.confirm().touched() && f.confirm().errors().length) {
              <mat-error>{{ f.confirm().errors()[0].message }}</mat-error>
            }
          </mat-form-field>

          @if (error(); as e) { <p class="err" role="alert">{{ e }}</p> }

          <button mat-flat-button type="submit" [disabled]="busy()">
            {{ store.hasPassword() ? 'Change password' : 'Set password' }}
          </button>
        </form>
      </section>

      <section class="panel">
        <h2>Where you are signed in</h2>
        @if (sessions.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

        <ul class="sessions">
          @for (s of sessions.value(); track s.id) {
            <li>
              <div>
                <strong>{{ s.device || 'Unknown device' }}</strong>
                @if (s.isCurrent) { <span class="tag">this one</span> }
                <span class="when">last seen {{ ago(s.lastSeenAt) }}</span>
              </div>
            </li>
          } @empty {
            @if (!sessions.isLoading()) {
              <li class="muted">No other sessions.</li>
            }
          }
        </ul>
      </section>
    </main>
  `,
  styles: `
    .wrap { max-width: 34rem; margin: 2.5rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.3rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem;
           text-transform: capitalize; }
    .panel { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px;
             padding: 1.4rem 1.5rem; display: flex; flex-direction: column; gap: 0.75rem; }
    h2 { margin: 0; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em;
         text-transform: uppercase; color: rgb(0 0 0 / 0.55); }
    form { display: flex; flex-direction: column; gap: 0.3rem; }
    .notice { margin: 0; font-size: 0.88rem; color: #6b4600; background: #fbf1dc;
              border-left: 3px solid #c98a16; padding: 0.7rem 0.9rem;
              border-radius: 0 6px 6px 0; }
    .ok { margin: 0; font-size: 0.88rem; color: #1b5e20; background: #e6f4ea;
          border-left: 3px solid #1b5e20; padding: 0.7rem 0.9rem;
          border-radius: 0 6px 6px 0; }
    .err { color: #b3261e; font-size: 0.88rem; margin: 0 0 0.5rem; }
    button[type='submit'] { align-self: flex-start; }
    .sessions { list-style: none; margin: 0; padding: 0;
                display: flex; flex-direction: column; gap: 0.6rem; }
    .sessions li { font-size: 0.88rem; border-top: 1px solid rgb(0 0 0 / 0.07);
                   padding-top: 0.6rem; }
    .sessions li:first-child { border-top: none; padding-top: 0; }
    .tag { font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
           letter-spacing: 0.05em; background: #e6f4ea; color: #1b5e20;
           border-radius: 999px; padding: 0.1rem 0.4rem; margin-left: 0.4rem; }
    .when { display: block; font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    .muted { color: rgb(0 0 0 / 0.5); }
  `,
})
export class AccountPage {
  protected readonly store = inject(AuthStore);

  protected readonly model = signal<PasswordModel>({
    currentPassword: '',
    password: '',
    confirm: '',
  });
  protected readonly f = form(this.model, passwordSchema);

  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly sessions = httpResource<SessionSummary[]>(
    () => '/api/v1/auth/sessions',
    {
      parse: (raw) => (raw as Envelope<SessionSummary[]>).data,
      defaultValue: [],
    },
  );

  protected save(): void {
    this.error.set(null);
    this.done.set(false);

    void submit(this.f, async () => {
      const value = this.model();
      this.busy.set(true);
      try {
        await this.store.setPassword(
          value.password,
          // Only sent when one exists; the server requires it in that case.
          this.store.hasPassword() ? value.currentPassword : undefined,
        );
        this.model.set({ currentPassword: '', password: '', confirm: '' });
        this.done.set(true);
        this.sessions.reload();
      } catch (e) {
        const err = e as AppError;
        this.error.set(
          err.code === 'AUTH_INVALID_CREDENTIALS'
            ? 'That is not your current password.'
            : err.message,
        );
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected ago(iso: string): string {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  }
}
