import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { EnquiryDto } from '@eventhub/contracts';

import { CustomerApi, unwrap } from '../data/customer-api';
import { formatEventDate } from '../data/booking-display';
import { StatusChip } from '../components/status-chip';
import type { Tone } from '../data/booking-display';

const LEG_TONE: Record<string, Tone> = {
  SENT: 'warn',
  QUOTED: 'good',
  DECLINED: 'neutral',
  EXPIRED: 'neutral',
};

const LEG_LABEL: Record<string, string> = {
  SENT: 'Waiting',
  QUOTED: 'Quoted',
  DECLINED: 'Declined',
  EXPIRED: 'No reply',
};

/**
 * Every enquiry the customer has raised, and how many vendors have come back.
 *
 * The count of quotes is the only number that matters here: it is what decides
 * whether there is anything worth comparing yet.
 */
@Component({
  selector: 'eh-enquiries-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusChip, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="band">
        <div class="lede">
          <h1>Your enquiries</h1>
          <p class="sub">One request, several vendors, their quotes side by side.</p>
        </div>
        <a mat-flat-button class="cta" routerLink="/customer/vendors">Find vendors</a>
      </header>

      @if (enquiries.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <div class="tiles">

      @for (enquiry of enquiries.value(); track enquiry.id) {
        <article class="card">
          <div class="row">
            <div>
              <h2>{{ label(enquiry.category) }} · {{ label(enquiry.functionType) }}</h2>
              <p class="meta">
                {{ formatEventDate(enquiry.functionDate) }} · {{ enquiry.city }} ·
                {{ enquiry.guestCount }} guests
              </p>
            </div>
            <span class="count" [class.ready]="quoted(enquiry) > 0">
              {{ quoted(enquiry) }}/{{ enquiry.vendors.length }} quoted
            </span>
          </div>

          <ul class="legs">
            @for (leg of enquiry.vendors; track leg.vendorId) {
              <li>
                <span>{{ leg.businessName }}</span>
                <eh-status-chip [label]="legLabel(leg.status)" [tone]="legTone(leg.status)" />
              </li>
            }
          </ul>

          @if (quoted(enquiry) > 0) {
            <a mat-flat-button [routerLink]="['/customer/enquiries', enquiry.id]">
              Compare {{ quoted(enquiry) }} quote{{ quoted(enquiry) === 1 ? '' : 's' }}
            </a>
          } @else {
            <p class="waiting">
              Vendors have {{ hoursLeft(enquiry) }} to reply.
            </p>
          }
        </article>
      } @empty {
        @if (!enquiries.isLoading()) {
          <section class="empty">
            <h2>No enquiries yet</h2>
            <p>Find vendors who are free on your date and ask a few of them at once.</p>
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

    /* The banded header the rest of the product uses. */
    .band { display: flex; align-items: center; justify-content: space-between;
            gap: 1.25rem; flex-wrap: wrap;
            padding: 1.1rem 1.35rem; border-radius: 14px;
            background: linear-gradient(120deg, var(--brand-deep), var(--brand-light));
            color: #fff; box-shadow: 0 6px 20px rgb(var(--brand-deep-rgb) / 0.25); }
    h1 { margin: 0; font-size: 1.45rem; font-weight: 600; }
    .band .sub { margin: 0.3rem 0 0; color: rgb(255 255 255 / 0.85); font-size: 0.88rem; }
    .cta { background: #fff !important; color: var(--brand-deep) !important; }

    /*
     * Tiles, not a single stack. An enquiry is a small, self-contained card -
     * category, date, who has answered - and a column of them down the middle
     * of a wide screen wastes two thirds of it while making the list look
     * longer than it is. min() keeps the floor inside a phone screen.
     */
    .tiles { display: grid; gap: 1rem;
             grid-template-columns: repeat(auto-fill, minmax(min(23rem, 100%), 1fr)); }
    .tiles .empty { grid-column: 1 / -1; }

    .card { border: 1px solid var(--brand-line); border-radius: 12px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.7rem;
            transition: transform 120ms ease, box-shadow 120ms ease; }
    .card:hover { transform: translateY(-2px);
                  box-shadow: 0 6px 16px rgb(var(--brand-rgb) / 0.12); }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.02rem; font-weight: 600; color: var(--brand-deep); }
    .meta { margin: 0.2rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .count { font-size: 0.74rem; font-weight: 700; white-space: nowrap;
             padding: 0.15rem 0.5rem; border-radius: 999px;
             background: var(--brand-tint); color: var(--brand-ink); }
    .count.ready { background: #e6f4ea; color: #1b5e20; }
    .legs { list-style: none; margin: 0; padding: 0.6rem 0 0;
            border-top: 1px solid var(--brand-line);
            display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.88rem; }
    .legs li { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .waiting { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.55); }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6);
             display: flex; flex-direction: column; gap: 0.5rem; align-items: center;
             border: 1px dashed var(--brand-line); border-radius: 12px; }
    .empty h2 { font-size: 1.1rem; margin: 0; }
    .card a[mat-flat-button] { align-self: flex-start; }

    @media (max-width: 560px) { .band { flex-direction: column; align-items: flex-start; } }
  `,
})
export class EnquiriesPage {
  private readonly api = inject(CustomerApi);

  protected readonly enquiries = httpResource<EnquiryDto[]>(
    () => this.api.enquiries,
    { parse: unwrap<EnquiryDto[]>, defaultValue: [] },
  );

  protected readonly quoted = (e: EnquiryDto): number =>
    e.vendors.filter((v) => v.status === 'QUOTED').length;

  protected readonly hoursLeft = (e: EnquiryDto): string => {
    const hours = (new Date(e.expiresAt).getTime() - Date.now()) / 3_600_000;
    if (hours <= 0) return 'no time left';
    return hours < 1 ? 'under an hour' : `about ${Math.round(hours)} hours`;
  };

  protected readonly legLabel = (status: string): string => LEG_LABEL[status] ?? status;
  protected readonly legTone = (status: string): Tone => LEG_TONE[status] ?? 'neutral';
  protected readonly formatEventDate = formatEventDate;
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}
