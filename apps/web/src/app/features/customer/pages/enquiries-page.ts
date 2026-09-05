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
      <header class="head">
        <div>
          <h1>Your enquiries</h1>
          <p class="sub">One request, several vendors, their quotes side by side.</p>
        </div>
        <a mat-flat-button routerLink="/customer/vendors">Find vendors</a>
      </header>

      @if (enquiries.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

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
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.7rem; }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.02rem; font-weight: 600; }
    .meta { margin: 0.2rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .count { font-size: 0.78rem; font-weight: 700; color: rgb(0 0 0 / 0.5); white-space: nowrap; }
    .count.ready { color: #1b5e20; }
    .legs { list-style: none; margin: 0; padding: 0.6rem 0 0;
            border-top: 1px solid rgb(0 0 0 / 0.08);
            display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.88rem; }
    .legs li { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .waiting { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.55); }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6);
             display: flex; flex-direction: column; gap: 0.5rem; align-items: center; }
    .empty h2 { font-size: 1.1rem; margin: 0; }
    a[mat-flat-button] { align-self: flex-start; }
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
