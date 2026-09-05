import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  formatInr,
  type BookingDto,
  type PaymentScheduleEntry,
  type RefundPreview,
} from '@eventhub/contracts';

import { CustomerApi, unwrap } from '../data/customer-api';
import {
  BOOKING_PRESENTATION,
  PAYMENT_PRESENTATION,
  daysUntil,
  formatDateTime,
  formatEventDate,
} from '../data/booking-display';
import { StatusChip } from '../components/status-chip';
import type { AppError } from '../../../core/models/app-error';

/**
 * One booking in full: where it stands, what has been paid, what is still owed,
 * and what the customer may do next.
 *
 * Two rules shape this page. The actions come from the server's
 * `allowedTransitions` rather than from rules restated here, so the buttons can
 * never offer something the state machine would refuse. And cancelling shows
 * the refund the server computes *before* asking to confirm - nobody should
 * discover what a cancellation costs after making it.
 */
@Component({
  selector: 'eh-booking-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusChip, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <a class="back" routerLink="/customer/bookings">&larr; All bookings</a>

      @if (booking.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (booking.value(); as b) {
        <header class="head">
          <div>
            <h1>{{ categoryLabel(b.category) }}</h1>
            <p class="date">
              {{ formatEventDate(b.eventDate) }}
              @if (daysUntil(b.eventDate) >= 0) {
                <span class="away">· {{ daysUntil(b.eventDate) }} days away</span>
              }
            </p>
          </div>
          <eh-status-chip
            [label]="presentation(b).label"
            [tone]="presentation(b).tone"
          />
        </header>

        <p class="hint">{{ presentation(b).hint }}</p>

        <section class="panel">
          <h2>Money</h2>
          <dl class="money">
            <div><dt>Agreed total</dt><dd>{{ inr(b.totalAmount) }}</dd></div>
            <div><dt>Paid so far</dt><dd>{{ inr(b.paidAmount) }}</dd></div>
            <div>
              <dt>Outstanding</dt>
              <dd>{{ inr(b.totalAmount - b.paidAmount) }}</dd>
            </div>
          </dl>
          <div class="meter" [attr.aria-label]="'Paid ' + paidPercent(b) + '%'">
            <span [style.width.%]="paidPercent(b)"></span>
          </div>
        </section>

        <section class="panel">
          <h2>Payment schedule</h2>
          @if (schedule.isLoading()) {
            <mat-progress-bar mode="indeterminate" />
          }
          <table class="sched">
            <thead>
              <tr>
                <th>Milestone</th><th>Amount</th><th>Due</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (row of schedule.value(); track row.milestone) {
                <tr>
                  <td>{{ categoryLabel(row.milestone) }}</td>
                  <td class="num">{{ inr(row.amount) }}</td>
                  <td>{{ formatEventDate(row.dueDate) }}</td>
                  <td>
                    <eh-status-chip
                      [label]="paymentPresentation(row).label"
                      [tone]="paymentPresentation(row).tone"
                    />
                  </td>
                  <td class="right">
                    @if (isPayable(b, row)) {
                      <a
                        mat-flat-button
                        [routerLink]="['/customer/bookings', b.id, 'pay', row.milestone]"
                      >
                        Pay now
                      </a>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="panel">
          <h2>History</h2>
          <ol class="timeline">
            @for (change of b.statusHistory; track $index) {
              <li>
                <span class="dot"></span>
                <div>
                  <strong>{{ label(change.to) }}</strong>
                  <span class="when">{{ formatDateTime(change.at) }}</span>
                  @if (change.reason) { <p class="why">{{ change.reason }}</p> }
                </div>
              </li>
            }
          </ol>
        </section>

        @if (canCancel(b)) {
          <section class="panel danger">
            <h2>Cancel this booking</h2>

            @if (!refund()) {
              <p class="hint">
                We will show you exactly what you get back before anything is cancelled.
              </p>
              <button mat-stroked-button [disabled]="busy()" (click)="previewRefund(b.id)">
                See what a cancellation refunds
              </button>
            } @else {
              <dl class="money">
                <div><dt>Paid</dt><dd>{{ inr(refund()!.paidAmount) }}</dd></div>
                <div class="hi">
                  <dt>You get back</dt><dd>{{ inr(refund()!.refundAmount) }}</dd>
                </div>
                <div><dt>Vendor keeps</dt><dd>{{ inr(refund()!.vendorRetains) }}</dd></div>
                <div><dt>Platform fee</dt><dd>{{ inr(refund()!.platformFee) }}</dd></div>
              </dl>
              <p class="hint">
                Based on cancelling {{ refund()!.daysUntilEvent }} days before the event,
                which refunds {{ refund()!.tierApplied.refundPercent }}%.
              </p>

              <label class="reason">
                <span>Reason (optional)</span>
                <textarea
                  rows="2"
                  maxlength="500"
                  [value]="reason()"
                  (input)="reason.set($any($event.target).value)"
                ></textarea>
              </label>

              <div class="actions">
                <button mat-button [disabled]="busy()" (click)="refund.set(null)">
                  Keep booking
                </button>
                <button
                  mat-flat-button
                  class="danger-btn"
                  [disabled]="busy()"
                  (click)="cancel(b.id)"
                >
                  Cancel and refund {{ inr(refund()!.refundAmount) }}
                </button>
              </div>
            }
          </section>
        }

        @if (error(); as e) {
          <p class="err" role="alert">{{ e }}</p>
        }
      }

      @if (booking.error()) {
        <p class="err" role="alert">
          This booking could not be loaded. It may not exist, or it may not be yours.
        </p>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.1rem; }
    .back { font-size: 0.85rem; color: #2f2d78; text-decoration: none; }
    .back:hover { text-decoration: underline; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .date { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.7); font-size: 0.9rem; }
    .away { color: rgb(0 0 0 / 0.45); }
    .hint { margin: 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.6); }
    .panel { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
             padding: 1.1rem 1.25rem; background: #fff;
             display: flex; flex-direction: column; gap: 0.7rem; }
    .panel h2 { margin: 0; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em;
                text-transform: uppercase; color: rgb(0 0 0 / 0.55); }
    .money { display: flex; gap: 2rem; margin: 0; flex-wrap: wrap; }
    .money div { display: flex; flex-direction: column; gap: 0.1rem; }
    .money .hi dd { color: #1b5e20; font-size: 1.15rem; }
    dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: rgb(0 0 0 / 0.5); }
    dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
    .meter { height: 6px; border-radius: 999px; background: #eceff1; overflow: hidden; }
    .meter span { display: block; height: 100%; background: #2f2d78; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th { text-align: left; font-size: 0.7rem; text-transform: uppercase;
         letter-spacing: 0.05em; color: rgb(0 0 0 / 0.5); font-weight: 700;
         padding: 0 0.5rem 0.4rem 0; }
    td { padding: 0.55rem 0.5rem 0.55rem 0; border-top: 1px solid rgb(0 0 0 / 0.08);
         vertical-align: middle; }
    .num { font-variant-numeric: tabular-nums; font-weight: 600; }
    .right { text-align: right; }
    .timeline { list-style: none; margin: 0; padding: 0;
                display: flex; flex-direction: column; gap: 0.7rem; }
    .timeline li { display: flex; gap: 0.7rem; align-items: flex-start; font-size: 0.88rem; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #2f2d78;
           margin-top: 0.35rem; flex: none; }
    .when { color: rgb(0 0 0 / 0.5); margin-left: 0.5rem; font-size: 0.8rem; }
    .why { margin: 0.15rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.85rem; }
    .danger { border-color: #f2c9c5; }
    .danger-btn { --mdc-filled-button-container-color: #b3261e; }
    .reason { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem;
              color: rgb(0 0 0 / 0.6); }
    .reason textarea { font: inherit; padding: 0.5rem; border-radius: 6px;
                       border: 1px solid rgb(0 0 0 / 0.25); resize: vertical; }
    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .err { color: #b3261e; font-size: 0.9rem; }
  `,
})
export class BookingDetailPage {
  private readonly api = inject(CustomerApi);
  private readonly router = inject(Router);

  /** From the route, via withComponentInputBinding() in app.config.ts. */
  readonly id = input.required<string>();

  protected readonly booking = httpResource<BookingDto>(
    () => this.api.bookingUrl(this.id()),
    { parse: unwrap<BookingDto> },
  );

  protected readonly schedule = httpResource<PaymentScheduleEntry[]>(
    () => this.api.scheduleUrl(this.id()),
    { parse: unwrap<PaymentScheduleEntry[]>, defaultValue: [] },
  );

  protected readonly refund = signal<RefundPreview | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly paidPercent = (b: BookingDto): number =>
    b.totalAmount ? Math.round((b.paidAmount / b.totalAmount) * 100) : 0;

  protected async previewRefund(bookingId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.refund.set(await this.api.refundPreview(bookingId));
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(bookingId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancelBooking(bookingId, this.reason());
      this.refund.set(null);
      // The status, the history and the schedule all changed.
      this.booking.reload();
      this.schedule.reload();
      await this.router.navigate(['/customer/bookings']);
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** The server says what may happen next; this page only reads that. */
  protected readonly canCancel = (b: BookingDto): boolean =>
    b.allowedTransitions.includes('CANCELLED');

  /**
   * A milestone is payable when the server would accept an intent for it:
   * the advance while the booking is only accepted, the balance once it is
   * confirmed, and neither once it is paid.
   */
  protected readonly isPayable = (
    b: BookingDto,
    row: PaymentScheduleEntry,
  ): boolean => {
    if (row.status === 'CAPTURED' || row.amount <= 0) return false;
    if (row.milestone === 'ADVANCE') return b.status === 'ACCEPTED';
    return b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS';
  };

  protected readonly formatEventDate = formatEventDate;
  protected readonly formatDateTime = formatDateTime;
  protected readonly daysUntil = daysUntil;
  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
  protected readonly presentation = (b: BookingDto) => BOOKING_PRESENTATION[b.status];
  protected readonly paymentPresentation = (row: PaymentScheduleEntry) =>
    PAYMENT_PRESENTATION[row.status];
  protected readonly label = (status: string): string =>
    BOOKING_PRESENTATION[status as BookingDto['status']]?.label ?? status;
  protected readonly categoryLabel = (c: string): string =>
    c.charAt(0) + c.slice(1).toLowerCase();
}
