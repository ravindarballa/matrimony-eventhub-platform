import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  formatInr,
  type PaymentIntentDto,
  type PaymentMilestone,
} from '@eventhub/contracts';

import { CustomerApi } from '../data/customer-api';
import type { AppError } from '../../../core/models/app-error';

type Phase = 'opening' | 'ready' | 'paying' | 'done' | 'failed';

/**
 * Checkout for one milestone.
 *
 * The page never names an amount of its own: it opens an intent and shows
 * whatever the server priced, because the amount is derived from the booking
 * server-side and a figure computed here could only ever disagree with it.
 *
 * One idempotency key is generated per visit and reused for every retry on this
 * screen, so a customer who taps twice, or reloads after a timeout, gets the
 * same order back rather than a second one.
 */
@Component({
  selector: 'eh-checkout-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <a class="back" [routerLink]="['/customer/bookings', bookingId()]">
        &larr; Back to booking
      </a>

      <section class="card">
        <h1>Pay {{ milestoneLabel() }}</h1>

        @switch (phase()) {
          @case ('opening') {
            <p class="sub">Opening a secure checkout…</p>
            <mat-progress-bar mode="indeterminate" />
          }

          @case ('ready') {
            @if (intent(); as i) {
              <p class="amount">{{ inr(i.amount) }}</p>
              <p class="sub">
                This is the amount the server calculated from your booking.
              </p>

              <dl class="meta">
                <div><dt>Booking</dt><dd class="mono">{{ i.bookingId }}</dd></div>
                <div><dt>Order</dt><dd class="mono">{{ i.gatewayOrderId }}</dd></div>
                <div><dt>Checkout closes</dt><dd>{{ expiry(i) }}</dd></div>
              </dl>

              <button mat-flat-button class="pay" (click)="pay(i.paymentId)">
                Pay {{ inr(i.amount) }}
              </button>

              <p class="dev">
                <strong>Development mode.</strong> The fake gateway has no hosted
                checkout, so this completes the payment through a signed webhook -
                the same verification and accounting path a real payment takes.
                No money moves.
              </p>
            }
          }

          @case ('paying') {
            <p class="sub">Confirming with the payment provider…</p>
            <mat-progress-bar mode="indeterminate" />
          }

          @case ('done') {
            <p class="ok">✓ Payment received</p>
            <p class="sub">
              Your booking is confirmed and the date is now held firmly in your name.
            </p>
            <a mat-flat-button [routerLink]="['/customer/bookings', bookingId()]">
              Back to booking
            </a>
          }

          @case ('failed') {
            <p class="err" role="alert">{{ error() }}</p>
            <div class="actions">
              <button mat-flat-button (click)="open()">Try again</button>
              <a mat-stroked-button [routerLink]="['/customer/bookings', bookingId()]">
                Back to booking
              </a>
            </div>
          }
        }
      </section>
    </main>
  `,
  styles: `
    .wrap { max-width: 32rem; margin: 3rem auto; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .back { font-size: 0.85rem; color: #2f2d78; text-decoration: none; }
    .back:hover { text-decoration: underline; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; background: #fff;
            padding: 1.75rem; display: flex; flex-direction: column; gap: 0.9rem; }
    h1 { margin: 0; font-size: 1.3rem; font-weight: 600; }
    .amount { margin: 0.5rem 0 0; font-size: 2.25rem; font-weight: 700;
              font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .sub { margin: 0; color: rgb(0 0 0 / 0.6); font-size: 0.88rem; }
    .meta { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.4rem 0 0; }
    .meta div { display: flex; justify-content: space-between; gap: 1rem;
                border-top: 1px solid rgb(0 0 0 / 0.08); padding-top: 0.5rem; }
    dt { font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    dd { margin: 0; font-size: 0.8rem; }
    .mono { font-family: ui-monospace, monospace; font-size: 0.75rem;
            overflow-wrap: anywhere; text-align: right; }
    .pay { margin-top: 0.5rem; height: 3rem; font-size: 1rem; }
    .dev { margin: 0; font-size: 0.78rem; line-height: 1.45; color: #8a5a00;
           background: #fbf1dc; border-left: 3px solid #c98a16;
           padding: 0.6rem 0.8rem; border-radius: 0 6px 6px 0; }
    .ok { margin: 0; font-size: 1.2rem; font-weight: 700; color: #1b5e20; }
    .err { color: #b3261e; font-size: 0.9rem; margin: 0; }
    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  `,
})
export class CheckoutPage {
  private readonly api = inject(CustomerApi);
  private readonly router = inject(Router);

  /** Both arrive from the route via withComponentInputBinding(). */
  readonly bookingId = input.required<string>();
  readonly milestone = input.required<PaymentMilestone>();

  protected readonly intent = signal<PaymentIntentDto | null>(null);
  protected readonly phase = signal<Phase>('opening');
  protected readonly error = signal<string | null>(null);

  /**
   * One key for this visit. Regenerated only when the customer navigates here
   * again, which is genuinely a new attempt.
   */
  private readonly idempotencyKey = crypto.randomUUID();

  constructor() {
    // The route inputs are set after construction, so opening the intent waits
    // for them rather than reading an empty id.
    effect(() => {
      const booking = this.bookingId();
      const milestone = this.milestone();
      if (booking && milestone && this.phase() === 'opening' && !this.intent()) {
        void this.open();
      }
    });
  }

  protected async open(): Promise<void> {
    this.phase.set('opening');
    this.error.set(null);
    try {
      this.intent.set(
        await this.api.createIntent(
          this.bookingId(),
          this.milestone(),
          this.idempotencyKey,
        ),
      );
      this.phase.set('ready');
    } catch (e) {
      const err = e as AppError;
      this.error.set(
        err.code === 'PAY_NOTHING_DUE'
          ? 'This milestone has already been paid in full.'
          : err.message,
      );
      this.phase.set('failed');
    }
  }

  protected async pay(paymentId: string): Promise<void> {
    this.phase.set('paying');
    this.error.set(null);
    try {
      await this.api.simulateCapture(paymentId);
      this.phase.set('done');
    } catch (e) {
      this.error.set((e as AppError).message);
      this.phase.set('failed');
    }
  }

  protected readonly milestoneLabel = (): string =>
    this.milestone() === 'ADVANCE' ? 'the advance' : 'the balance';

  protected readonly expiry = (i: PaymentIntentDto): string =>
    new Date(i.expiresAt).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    });

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
}
