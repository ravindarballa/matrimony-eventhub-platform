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
      <header class="band">
        <div class="lede">
          <h1>Your bookings</h1>
          <p class="sub">Vendors booked for your wedding functions.</p>
        </div>
        <a mat-flat-button class="cta" routerLink="/customer/vendors">Book another</a>
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

      <div class="tiles">

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
            <a mat-flat-button routerLink="/customer/vendors">Find vendors</a>
          </section>
        }
      }
      </div>
    </main>
  `,
  styles: `
    .wrap { max-width: 74rem; margin: 1.5rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }

    .band { display: flex; align-items: center; justify-content: space-between;
            gap: 1.25rem; flex-wrap: wrap;
            padding: 1.1rem 1.35rem; border-radius: 14px;
            background: linear-gradient(120deg, var(--brand-deep), var(--brand-light));
            color: #fff; box-shadow: 0 6px 20px rgb(var(--brand-deep-rgb) / 0.25); }
    h1 { margin: 0; font-size: 1.45rem; font-weight: 600; }
    .band .sub { margin: 0.3rem 0 0; color: rgb(255 255 255 / 0.85); font-size: 0.88rem; }
    .cta { background: #fff !important; color: var(--brand-deep) !important; }

    .alert { background: #fbf1dc; border-left: 3px solid #c98a16;
             padding: 0.75rem 1rem; border-radius: 0 6px 6px 0; font-size: 0.9rem; }

    /* One booking is a small card of facts and two buttons; side by side they
       read as a list of commitments rather than as a long scroll. */
    .tiles { display: grid; gap: 1rem;
             grid-template-columns: repeat(auto-fill, minmax(min(23rem, 100%), 1fr)); }
    .tiles .empty { grid-column: 1 / -1; }

    .card { border: 1px solid var(--brand-line); border-radius: 12px;
            padding: 1.1rem 1.25rem; background: #fff;
            display: flex; flex-direction: column; gap: 0.6rem;
            transition: transform 120ms ease, box-shadow 120ms ease; }
    .card:hover { transform: translateY(-2px);
                  box-shadow: 0 6px 16px rgb(var(--brand-rgb) / 0.12); }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; color: var(--brand-deep); }
    .date { margin: 0.2rem 0 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.7); }
    .away { color: rgb(0 0 0 / 0.5); }
    .hint { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }

    /* The three figures that decide whether anything is owed, on one line. */
    .money { margin: 0; display: grid; grid-template-columns: repeat(3, 1fr);
             gap: 0.5rem; padding: 0.7rem 0; border-top: 1px solid var(--brand-line);
             border-bottom: 1px solid var(--brand-line); }
    .money > div { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .money dt { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
                color: rgb(0 0 0 / 0.45); }
    .money dd { margin: 0; font-size: 0.92rem; font-weight: 600;
                color: var(--brand-ink); font-variant-numeric: tabular-nums; }

    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .err { margin: 0; padding: 0.8rem 1rem; border-radius: 8px;
           background: #fdecea; color: #7f1d1d; font-size: 0.9rem; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6);
             display: flex; flex-direction: column; gap: 0.5rem; align-items: center;
             border: 1px dashed var(--brand-line); border-radius: 12px; }
    .empty h2 { font-size: 1.1rem; margin: 0; }

    @media (max-width: 560px) { .band { flex-direction: column; align-items: flex-start; } }
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
