import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { formatInr, type BookingDto } from '@eventhub/contracts';

import { CustomerApi, unwrap } from '../data/customer-api';
import {
  BOOKING_PRESENTATION,
  daysUntil,
  formatEventDate,
} from '../data/booking-display';
import { StatusChip } from '../components/status-chip';

/**
 * Everything the customer has booked, soonest event first.
 *
 * The list leads with what needs doing rather than with data: a booking whose
 * advance is unpaid says so and offers the payment, because that is the state
 * where the customer can still lose their date.
 */
@Component({
  selector: 'eh-bookings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusChip, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <h1>Your bookings</h1>
        <p class="sub">Vendors booked for your wedding functions.</p>
      </header>

      @if (bookings.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (bookings.error()) {
        <p class="err" role="alert">
          Your bookings could not be loaded.
          <button mat-button (click)="bookings.reload()">Try again</button>
        </p>
      }

      @if (needingPayment().length) {
        <section class="alert" role="status">
          <strong>{{ needingPayment().length }} booking(s) still need an advance.</strong>
          A held date is released if the advance is not paid within 48 hours.
        </section>
      }

      @for (booking of sorted(); track booking.id) {
        <article class="card">
          <div class="row">
            <div class="left">
              <h2>{{ categoryLabel(booking.category) }}</h2>
              <p class="date">
                {{ formatEventDate(booking.eventDate) }}
                @if (daysUntil(booking.eventDate) >= 0) {
                  <span class="away">· in {{ daysUntil(booking.eventDate) }} days</span>
                }
              </p>
            </div>
            <eh-status-chip
              [label]="presentation(booking).label"
              [tone]="presentation(booking).tone"
            />
          </div>

          <p class="hint">{{ presentation(booking).hint }}</p>

          <dl class="money">
            <div><dt>Total</dt><dd>{{ inr(booking.totalAmount) }}</dd></div>
            <div><dt>Paid</dt><dd>{{ inr(booking.paidAmount) }}</dd></div>
            <div>
              <dt>Outstanding</dt>
              <dd>{{ inr(booking.totalAmount - booking.paidAmount) }}</dd>
            </div>
          </dl>

          <div class="actions">
            <a mat-stroked-button [routerLink]="['/customer/bookings', booking.id]">
              View booking
            </a>
            @if (booking.status === 'ACCEPTED') {
              <a
                mat-flat-button
                [routerLink]="['/customer/bookings', booking.id, 'pay', 'ADVANCE']"
              >
                Pay advance · {{ inr(booking.advanceAmount) }}
              </a>
            }
          </div>
        </article>
      } @empty {
        @if (!bookings.isLoading() && !bookings.error()) {
          <section class="empty">
            <h2>No bookings yet</h2>
            <p>
              Once you accept a vendor's quote, the booking appears here with its
              payment schedule.
            </p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .alert { background: #fbf1dc; border-left: 3px solid #c98a16;
             padding: 0.75rem 1rem; border-radius: 0 6px 6px 0; font-size: 0.9rem; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            padding: 1.1rem 1.25rem; background: #fff;
            display: flex; flex-direction: column; gap: 0.6rem; }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .date { margin: 0.2rem 0 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.7); }
    .away { color: rgb(0 0 0 / 0.45); }
    .hint { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .money { display: flex; gap: 2rem; margin: 0.2rem 0 0; flex-wrap: wrap; }
    .money div { display: flex; flex-direction: column; gap: 0.1rem; }
    dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: rgb(0 0 0 / 0.5); }
    dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.3rem; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
  `,
})
export class BookingsPage {
  private readonly api = inject(CustomerApi);

  /**
   * Declared, not fetched: httpResource owns the request lifecycle, so the page
   * has no subscription to manage and reload() is a one-liner after a change.
   */
  protected readonly bookings = httpResource<BookingDto[]>(() => this.api.bookings, {
    parse: unwrap<BookingDto[]>,
    defaultValue: [],
  });

  protected readonly sorted = computed(() =>
    [...this.bookings.value()].sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
  );

  protected readonly needingPayment = computed(() =>
    this.bookings.value().filter((b) => b.status === 'ACCEPTED'),
  );

  protected readonly formatEventDate = formatEventDate;
  protected readonly daysUntil = daysUntil;
  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
  protected readonly presentation = (b: BookingDto) => BOOKING_PRESENTATION[b.status];

  /** VENUE -> Venue. The enum is a wire value, not something to show a person. */
  protected readonly categoryLabel = (c: string): string =>
    c.charAt(0) + c.slice(1).toLowerCase();
}
