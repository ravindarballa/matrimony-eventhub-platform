import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { formatInr, type EnquiryDto, type QuoteDto } from '@eventhub/contracts';

import { CustomerApi, unwrap } from '../data/customer-api';
import { formatEventDate } from '../data/booking-display';
import type { AppError } from '../../../core/models/app-error';

/**
 * The quotes for one enquiry, side by side.
 *
 * Accepting is the moment the platform stops being a directory: it locks the
 * vendor's date against everyone else, which is why the button says what will
 * happen and why a failure here is shown plainly rather than retried quietly -
 * losing the race means somebody else took the date.
 */
@Component({
  selector: 'eh-quote-comparison-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <a class="back" routerLink="/customer/enquiries">&larr; All enquiries</a>

      @if (enquiry.value(); as e) {
        <header class="head">
          <h1>{{ label(e.category) }} quotes</h1>
          <p class="sub">
            {{ formatEventDate(e.functionDate) }} · {{ e.city }} ·
            {{ e.guestCount }} guests
          </p>
        </header>
      }

      @if (quotes.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }

      @for (quote of quotes.value(); track quote.id; let first = $first) {
        <article class="card" [class.best]="first">
          <div class="row">
            <div>
              <h2>{{ vendorName(quote.vendorId) }}</h2>
              @if (first) { <span class="badge">Lowest quote</span> }
            </div>
            <div class="total">
              <strong>{{ inr(quote.total) }}</strong>
              <span class="incl">incl. GST</span>
            </div>
          </div>

          <table class="lines">
            <tbody>
              @for (line of quote.lineItems; track $index) {
                <tr>
                  <td>{{ line.description }}</td>
                  <td class="qty">{{ line.quantity }} × {{ inr(line.unitPrice) }}</td>
                  <td class="num">{{ inr(line.lineTotal) }}</td>
                </tr>
              }
              <tr class="sum">
                <td colspan="2">Subtotal</td>
                <td class="num">{{ inr(quote.subtotal) }}</td>
              </tr>
              <tr class="sum">
                <td colspan="2">GST</td>
                <td class="num">{{ inr(quote.gstAmount) }}</td>
              </tr>
            </tbody>
          </table>

          <p class="terms">
            {{ quote.advancePercent }}% advance ({{ inr(advance(quote)) }}) ·
            valid until {{ formatEventDate(quote.validUntil) }}
          </p>

          <button
            mat-flat-button
            [disabled]="busy()"
            (click)="accept(quote)"
          >
            Accept and hold the date
          </button>
        </article>
      } @empty {
        @if (!quotes.isLoading()) {
          <section class="empty">
            <h2>No quotes yet</h2>
            <p>Vendors have 24 hours to respond. We will show them here as they arrive.</p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .back { font-size: 0.85rem; color: #2f2d78; text-decoration: none; }
    .back:hover { text-decoration: underline; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.7rem; }
    .card.best { border-color: #1b5e20; }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .badge { display: inline-block; margin-top: 0.3rem; font-size: 0.68rem; font-weight: 700;
             letter-spacing: 0.04em; text-transform: uppercase; color: #1b5e20;
             background: #e6f4ea; border: 1px solid #c8e6c9;
             padding: 0.15rem 0.45rem; border-radius: 999px; }
    .total { text-align: right; }
    .total strong { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
    .incl { display: block; font-size: 0.7rem; color: rgb(0 0 0 / 0.5); }
    table { width: 100%; border-collapse: collapse; font-size: 0.87rem; }
    td { padding: 0.4rem 0.5rem 0.4rem 0; border-top: 1px solid rgb(0 0 0 / 0.07); }
    .qty { color: rgb(0 0 0 / 0.55); white-space: nowrap; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sum td { color: rgb(0 0 0 / 0.6); }
    .terms { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
    button { align-self: flex-start; }
  `,
})
export class QuoteComparisonPage {
  private readonly api = inject(CustomerApi);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly enquiry = httpResource<EnquiryDto>(
    () => `${this.api.enquiries}/${this.id()}`,
    { parse: unwrap<EnquiryDto> },
  );

  /** The server sorts these cheapest first, so the first card is the lowest. */
  protected readonly quotes = httpResource<QuoteDto[]>(
    () => this.api.quotesUrl(this.id()),
    { parse: unwrap<QuoteDto[]>, defaultValue: [] },
  );

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** vendorId -> the name shown on the enquiry, so cards are not bare ids. */
  private readonly names = computed(() => {
    const map = new Map<string, string>();
    for (const leg of this.enquiry.value()?.vendors ?? []) {
      map.set(leg.vendorId, leg.businessName);
    }
    return map;
  });

  protected async accept(quote: QuoteDto): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const booking = await this.api.acceptQuote(quote.id);
      await this.router.navigate(['/customer/bookings', booking.id]);
    } catch (e) {
      const err = e as AppError;
      // The one failure worth explaining rather than merely reporting.
      this.error.set(
        err.code === 'EVT_SLOT_TAKEN'
          ? 'That date was just taken by another booking. Please choose another quote or another date.'
          : err.message,
      );
      this.quotes.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly advance = (quote: QuoteDto): number =>
    Math.round((quote.total * quote.advancePercent) / 100);

  protected readonly vendorName = (vendorId: string): string =>
    this.names().get(vendorId) ?? 'Vendor';

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
  protected readonly formatEventDate = formatEventDate;
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}
