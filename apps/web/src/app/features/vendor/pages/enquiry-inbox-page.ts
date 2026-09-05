import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  GST_BPS,
  formatInr,
  toPaisa,
  type VendorEnquiryDto,
} from '@eventhub/contracts';

import { VendorApi, unwrap } from '../data/vendor-api';
import type { AppError } from '../../../core/models/app-error';

interface DraftLine {
  description: string;
  quantity: number;
  /** Rupees while being typed; converted to paisa on submit. */
  unitPriceRupees: number;
}

const emptyLine = (): DraftLine => ({
  description: '',
  quantity: 1,
  unitPriceRupees: 0,
});

/**
 * The vendor's working screen: what has been asked, how long is left to answer,
 * and the quote builder itself.
 *
 * Ordering is by SLA rather than by arrival, and the row turns amber then red
 * as the clock runs down, because a vendor's median response time is a search
 * ranking input - the cost of ignoring this list is fewer enquiries next month.
 *
 * The running total shown while building a quote is an estimate for the vendor's
 * benefit only. The server recomputes every figure on submit and its numbers are
 * the ones that reach the customer.
 */
@Component({
  selector: 'eh-enquiry-inbox-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <div>
          <h1>Enquiries</h1>
          <p class="sub">Most urgent first. Answering quickly improves your ranking.</p>
        </div>
        <button mat-stroked-button (click)="inbox.reload()">Refresh</button>
      </header>

      @if (inbox.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }

      @for (enquiry of inbox.value(); track enquiry.id) {
        <article class="card" [class]="urgency(enquiry)">
          <div class="row">
            <div>
              <h2>{{ label(enquiry.functionType) }} · {{ enquiry.guestCount }} guests</h2>
              <p class="meta">
                {{ eventDate(enquiry.functionDate) }} · {{ enquiry.city }}
                @if (enquiry.budget) {
                  · budget {{ inr(enquiry.budget) }}
                }
              </p>
            </div>
            <span class="sla">{{ slaLabel(enquiry) }}</span>
          </div>

          @if (enquiry.notes) {
            <p class="notes">“{{ enquiry.notes }}”</p>
          }

          @switch (enquiry.status) {
            @case ('QUOTED') {
              <p class="done">✓ You have quoted for this enquiry.</p>
            }
            @case ('DECLINED') {
              <p class="muted">You declined this enquiry.</p>
            }
            @case ('EXPIRED') {
              <p class="muted">This enquiry expired before it was answered.</p>
            }
            @default {
              @if (building() === enquiry.id) {
                <section class="builder">
                  <h3>Quote</h3>

                  @for (line of lines(); track $index; let i = $index) {
                    <div class="line">
                      <input
                        class="desc"
                        placeholder="What is included"
                        [value]="line.description"
                        (input)="edit(i, 'description', $any($event.target).value)"
                      />
                      <input
                        class="qty"
                        type="number"
                        min="1"
                        [value]="line.quantity"
                        (input)="edit(i, 'quantity', $any($event.target).value)"
                      />
                      <input
                        class="rate"
                        type="number"
                        min="0"
                        placeholder="₹ per unit"
                        [value]="line.unitPriceRupees"
                        (input)="edit(i, 'unitPriceRupees', $any($event.target).value)"
                      />
                      <span class="num">{{ inr(lineTotal(line)) }}</span>
                      <button
                        class="drop"
                        type="button"
                        [disabled]="lines().length === 1"
                        (click)="removeLine(i)"
                        aria-label="Remove line"
                      >×</button>
                    </div>
                  }

                  <button mat-button type="button" (click)="addLine()">+ Add line</button>

                  <dl class="totals">
                    <div><dt>Subtotal</dt><dd>{{ inr(subtotal()) }}</dd></div>
                    <div><dt>GST (18%)</dt><dd>{{ inr(gst()) }}</dd></div>
                    <div class="grand"><dt>Total</dt><dd>{{ inr(total()) }}</dd></div>
                  </dl>
                  <p class="hint">
                    The server recalculates these from your lines when you send.
                  </p>

                  <div class="terms">
                    <label>
                      <span>Advance %</span>
                      <input
                        type="number"
                        min="10"
                        max="50"
                        [value]="advancePercent()"
                        (input)="advancePercent.set(+$any($event.target).value)"
                      />
                    </label>
                    <label>
                      <span>Valid for (days)</span>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        [value]="validForDays()"
                        (input)="validForDays.set(+$any($event.target).value)"
                      />
                    </label>
                  </div>

                  <div class="actions">
                    <button mat-button [disabled]="busy()" (click)="building.set(null)">
                      Cancel
                    </button>
                    <button
                      mat-flat-button
                      [disabled]="busy() || !canSend()"
                      (click)="send(enquiry.id)"
                    >
                      Send quote
                    </button>
                  </div>
                </section>
              } @else {
                <div class="actions">
                  <button mat-flat-button (click)="startQuote(enquiry.id)">
                    Build a quote
                  </button>
                  <button mat-button [disabled]="busy()" (click)="decline(enquiry.id)">
                    Decline
                  </button>
                </div>
              }
            }
          }
        </article>
      } @empty {
        @if (!inbox.isLoading()) {
          <section class="empty">
            <h2>Nothing waiting</h2>
            <p>New enquiries for your category and city will appear here.</p>
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
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-left-width: 4px;
            border-radius: 10px; background: #fff; padding: 1.1rem 1.25rem;
            display: flex; flex-direction: column; gap: 0.6rem; }
    .card.fresh { border-left-color: #2f2d78; }
    .card.soon  { border-left-color: #c98a16; }
    .card.late  { border-left-color: #b3261e; }
    .card.closed { border-left-color: rgb(0 0 0 / 0.15); }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.02rem; font-weight: 600; }
    .meta { margin: 0.2rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .sla { font-size: 0.78rem; font-weight: 700; white-space: nowrap; color: rgb(0 0 0 / 0.6); }
    .card.late .sla { color: #b3261e; }
    .card.soon .sla { color: #8a5a00; }
    .notes { margin: 0; font-size: 0.88rem; font-style: italic; color: rgb(0 0 0 / 0.7); }
    .done { margin: 0; color: #1b5e20; font-size: 0.88rem; font-weight: 600; }
    .muted { margin: 0; color: rgb(0 0 0 / 0.5); font-size: 0.88rem; }
    .builder { border-top: 1px solid rgb(0 0 0 / 0.08); padding-top: 0.8rem;
               display: flex; flex-direction: column; gap: 0.5rem; }
    .builder h3 { margin: 0; font-size: 0.72rem; text-transform: uppercase;
                  letter-spacing: 0.06em; color: rgb(0 0 0 / 0.55); }
    .line { display: grid; grid-template-columns: 1fr 4rem 7rem auto 1.5rem;
            gap: 0.4rem; align-items: center; }
    .line input { font: inherit; font-size: 0.88rem; padding: 0.35rem 0.5rem;
                  border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px; width: 100%; }
    .num { font-variant-numeric: tabular-nums; font-size: 0.85rem; text-align: right;
           white-space: nowrap; }
    .drop { border: none; background: none; font-size: 1.1rem; cursor: pointer;
            color: rgb(0 0 0 / 0.45); }
    .drop:disabled { opacity: 0.3; cursor: default; }
    .totals { display: flex; flex-direction: column; gap: 0.25rem; margin: 0.4rem 0 0;
              font-size: 0.88rem; }
    .totals div { display: flex; justify-content: space-between;
                  border-top: 1px solid rgb(0 0 0 / 0.07); padding-top: 0.25rem; }
    .totals dt, .totals dd { margin: 0; }
    .totals dd { font-variant-numeric: tabular-nums; }
    .grand { font-weight: 700; }
    .hint { margin: 0; font-size: 0.78rem; color: rgb(0 0 0 / 0.5); }
    .terms { display: flex; gap: 1rem; flex-wrap: wrap; }
    .terms label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem;
                   text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .terms input { font: inherit; font-size: 0.9rem; padding: 0.35rem 0.5rem; width: 7rem;
                   border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px; }
    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
  `,
})
export class EnquiryInboxPage {
  private readonly api = inject(VendorApi);

  protected readonly inbox = httpResource<VendorEnquiryDto[]>(
    () => this.api.inboxUrl,
    { parse: unwrap<VendorEnquiryDto[]>, defaultValue: [] },
  );

  protected readonly building = signal<string | null>(null);
  protected readonly lines = signal<DraftLine[]>([emptyLine()]);
  protected readonly advancePercent = signal(25);
  protected readonly validForDays = signal(7);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly subtotal = computed(() =>
    this.lines().reduce((n, l) => n + this.lineTotal(l), 0),
  );
  protected readonly gst = computed(() =>
    Math.round((this.subtotal() * GST_BPS) / 10_000),
  );
  protected readonly total = computed(() => this.subtotal() + this.gst());

  protected readonly canSend = computed(() =>
    this.lines().every((l) => l.description.trim().length >= 2 && l.unitPriceRupees > 0),
  );

  protected startQuote(enquiryId: string): void {
    this.lines.set([emptyLine()]);
    this.advancePercent.set(25);
    this.validForDays.set(7);
    this.error.set(null);
    this.building.set(enquiryId);
  }

  protected addLine(): void {
    this.lines.update((lines) => [...lines, emptyLine()]);
  }

  protected removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  protected edit(index: number, key: keyof DraftLine, raw: string): void {
    this.lines.update((lines) =>
      lines.map((line, i) =>
        i === index
          ? {
              ...line,
              [key]: key === 'description' ? raw : Number(raw),
            }
          : line,
      ),
    );
  }

  protected async send(enquiryId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.sendQuote(enquiryId, {
        lineItems: this.lines().map((line) => ({
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: toPaisa(Number(line.unitPriceRupees)),
        })),
        advancePercent: Number(this.advancePercent()),
        validForDays: Number(this.validForDays()),
      });
      this.building.set(null);
      this.inbox.reload();
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async decline(enquiryId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.decline(enquiryId);
      this.inbox.reload();
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** Amber past 12 hours gone, red once the SLA is missed. */
  protected readonly urgency = (e: VendorEnquiryDto): string => {
    if (e.status !== 'SENT') return 'closed';
    if (e.hoursRemaining <= 0) return 'late';
    return e.hoursRemaining <= 12 ? 'soon' : 'fresh';
  };

  protected readonly slaLabel = (e: VendorEnquiryDto): string => {
    if (e.status !== 'SENT') return '';
    if (e.hoursRemaining <= 0) return 'overdue';
    return e.hoursRemaining < 1
      ? `${Math.round(e.hoursRemaining * 60)} min left`
      : `${Math.round(e.hoursRemaining)} h left`;
  };

  protected readonly lineTotal = (line: DraftLine): number =>
    Math.round(Number(line.quantity) * Number(line.unitPriceRupees) * 100);

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  protected readonly eventDate = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
}
