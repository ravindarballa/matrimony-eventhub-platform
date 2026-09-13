import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  FunctionType,
  MAX_ENQUIRY_VENDORS,
  VendorCategory,
  formatInr,
  type VendorSearchResult,
  type WeddingDto,
} from '@eventhub/contracts';

import { CustomerApi, unwrap } from '../data/customer-api';
import { formatEventDate } from '../data/booking-display';
import type { AppError } from '../../../core/models/app-error';

const CATEGORIES = Object.values(VendorCategory);
const FUNCTIONS = Object.values(FunctionType);

/**
 * Find vendors, then ask several of them at once.
 *
 * The date filter is the point of the screen: results are restricted to vendors
 * who are actually free that day, so a customer never falls for a venue that
 * was already gone. Selection is capped at five because an enquiry sent to
 * everyone is a broadcast, and vendors stop answering broadcasts.
 */
@Component({
  selector: 'eh-vendor-search-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="band">
        <div class="lede">
          <h1>Find vendors</h1>
          <p class="sub">
            Only vendors free on your date are shown, so everything here is
            bookable.
          </p>
        </div>
      </header>

      <section class="filters">
        <label>
          <span>Category</span>
          <select [value]="category()" (change)="category.set($any($event.target).value)">
            @for (c of categories; track c) {
              <option [value]="c">{{ label(c) }}</option>
            }
          </select>
        </label>

        <label>
          <span>City</span>
          <input
            type="text"
            placeholder="Pune"
            [value]="city()"
            (change)="city.set($any($event.target).value)"
          />
        </label>

        <label>
          <span>Function date</span>
          <input
            type="date"
            [value]="date()"
            (change)="date.set($any($event.target).value)"
          />
        </label>

        <label>
          <span>Sort by</span>
          <select [value]="sort()" (change)="sort.set($any($event.target).value)">
            <option value="rating">Rating</option>
            <option value="price">Price</option>
            <option value="response">Response time</option>
          </select>
        </label>
      </section>

      @if (results.isLoading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (selected().size) {
        <section class="tray" role="status">
          <div>
            <strong>{{ selected().size }} selected</strong>
            <span class="muted"> · up to {{ maxVendors }}</span>
          </div>
          <button mat-flat-button [disabled]="busy()" (click)="sendEnquiry()">
            Ask {{ selected().size === 1 ? 'this vendor' : 'these vendors' }} for a quote
          </button>
        </section>
      }

      @if (error(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }

      <div class="tiles">

      @for (vendor of results.value(); track vendor.id) {
        <article class="card" [class.picked]="selected().has(vendor.id)">
          @if (vendor.photos[0]; as cover) {
            <img class="cover" [src]="cover.url" [alt]="vendor.businessName" />
          }
          <div class="row">
            <div>
              <h2>{{ vendor.businessName }}</h2>
              <p class="meta">
                {{ label(vendor.category) }} · {{ vendor.city }}
                @if (vendor.kycStatus === 'VERIFIED') {
                  <span class="verified" title="Identity and bank details verified">
                    ✓ Verified
                  </span>
                }
              </p>
            </div>
            <div class="price">
              @if (vendor.priceFrom) {
                <span class="from">from</span>
                <strong>{{ inr(vendor.priceFrom) }}</strong>
              }
            </div>
          </div>

          <p class="desc">{{ vendor.description }}</p>

          <div class="stats">
            <span>{{ vendor.rating || '—' }}★ ({{ vendor.reviewCount }})</span>
            <span>{{ vendor.completedBookings }} bookings</span>
            @if (vendor.medianResponseMins !== null) {
              <span>replies in ~{{ responseLabel(vendor.medianResponseMins!) }}</span>
            }
          </div>

          @if (vendor.services.length) {
            <ul class="services">
              @for (service of vendor.services; track service.id) {
                <li>
                  <strong>{{ service.title }}</strong>
                  <span>{{ inr(service.basePrice) }} {{ perUnit(service.pricingModel) }}</span>
                </li>
              }
            </ul>
          }

          <button
            mat-stroked-button
            [disabled]="!selected().has(vendor.id) && selected().size >= maxVendors"
            (click)="toggle(vendor)"
          >
            {{ selected().has(vendor.id) ? 'Remove' : 'Add to enquiry' }}
          </button>
        </article>
      } @empty {
        @if (!results.isLoading()) {
          <section class="empty">
            <h2>Nothing free on that date</h2>
            <p>Try another date, a nearby city, or a different category.</p>
          </section>
        }
      }
      </div>
    </main>
  `,
  styles: `
    .wrap { max-width: 74rem; margin: 1.5rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }

    .band { padding: 1.1rem 1.35rem; border-radius: 14px;
            background: linear-gradient(120deg, var(--brand-deep), var(--brand-light));
            color: #fff; box-shadow: 0 6px 20px rgb(var(--brand-deep-rgb) / 0.25); }
    h1 { margin: 0; font-size: 1.45rem; font-weight: 600; }
    .band .sub { margin: 0.3rem 0 0; color: rgb(255 255 255 / 0.85); font-size: 0.88rem;
                 max-width: 40rem; }

    .filters { display: flex; gap: 0.75rem; flex-wrap: wrap;
               background: #fff; border: 1px solid var(--brand-line);
               border-radius: 12px; padding: 0.9rem 1rem; }
    .filters label { display: flex; flex-direction: column; gap: 0.25rem;
                     font-size: 0.72rem; text-transform: uppercase;
                     letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .filters input, .filters select { font: inherit; font-size: 0.9rem;
                     padding: 0.4rem 0.5rem; border-radius: 6px;
                     border: 1px solid rgb(0 0 0 / 0.25); text-transform: none;
                     letter-spacing: normal; color: rgb(0 0 0 / 0.87); background: #fff; }

    /* Sticky so the count and the send button stay reachable while comparing. */
    .tray { position: sticky; top: 4.5rem; z-index: 5;
            display: flex; align-items: center; justify-content: space-between;
            gap: 1rem; background: var(--brand); color: #fff;
            padding: 0.7rem 1rem; border-radius: 10px;
            box-shadow: 0 4px 14px rgb(var(--brand-deep-rgb) / 0.3); }
    .muted { opacity: 0.7; }

    /*
     * Photo-forward tiles rather than a single column. A vendor is chosen from
     * the picture first and the particulars second, and three across lets a
     * customer compare them instead of scrolling between them.
     */
    .tiles { display: grid; gap: 1rem;
             grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr)); }
    .tiles .empty { grid-column: 1 / -1; }

    .card { border: 1px solid var(--brand-line); border-radius: 12px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem;
            transition: transform 120ms ease, box-shadow 120ms ease; }
    .card:hover { transform: translateY(-2px);
                  box-shadow: 0 6px 16px rgb(var(--brand-rgb) / 0.12); }
    .card.picked { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; }

    .cover { width: calc(100% + 2.5rem); margin: -1.1rem -1.25rem 0;
             aspect-ratio: 16 / 9; object-fit: cover; display: block;
             background: rgb(0 0 0 / 0.05); border-radius: 11px 11px 0 0; }

    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.02rem; font-weight: 600; color: var(--brand-deep); }
    .meta { margin: 0.2rem 0 0; font-size: 0.82rem; color: rgb(0 0 0 / 0.6); }
    .verified { color: #1b5e20; font-weight: 700; margin-left: 0.4rem; }
    .price { text-align: right; white-space: nowrap; }
    .from { display: block; font-size: 0.7rem; color: rgb(0 0 0 / 0.5); }
    .price strong { font-variant-numeric: tabular-nums; color: var(--brand-ink); }

    /* Two lines of description: enough to tell tiles apart, not enough to make
       one twice the height of its neighbour. */
    .desc { margin: 0; font-size: 0.86rem; color: rgb(0 0 0 / 0.75);
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            overflow: hidden; }

    .stats { display: flex; gap: 0.9rem; font-size: 0.78rem;
             color: rgb(0 0 0 / 0.55); flex-wrap: wrap; }
    .services { list-style: none; margin: 0; padding: 0.6rem 0 0;
                border-top: 1px solid var(--brand-line);
                display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.83rem; }
    .services li { display: flex; justify-content: space-between; gap: 1rem; }

    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6);
             border: 1px dashed var(--brand-line); border-radius: 12px; }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
    /* margin-top:auto pins the button to the bottom so tiles of differing
       height still line their actions up. */
    .card button { align-self: flex-start; margin-top: auto; }
  `,
})
export class VendorSearchPage {
  private readonly api = inject(CustomerApi);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly maxVendors = MAX_ENQUIRY_VENDORS;

  protected readonly category = signal<VendorCategory>('VENUE');
  protected readonly city = signal('');
  protected readonly date = signal('');
  protected readonly sort = signal<'rating' | 'price' | 'response'>('rating');

  protected readonly selected = signal<Map<string, VendorSearchResult>>(new Map());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * The URL is derived from the filter signals, so editing a filter is the
   * whole of "re-run the search" - there is no submit handler and no
   * subscription to keep in step.
   */
  protected readonly results = httpResource<VendorSearchResult[]>(
    () =>
      this.api.searchUrl({
        category: this.category(),
        city: this.city() || undefined,
        date: this.date() || undefined,
        sort: this.sort(),
      }),
    { parse: unwrap<VendorSearchResult[]>, defaultValue: [] },
  );

  /** The customer's wedding, needed before an enquiry can be raised. */
  private readonly weddings = httpResource<WeddingDto[]>(() => this.api.weddings, {
    parse: unwrap<WeddingDto[]>,
    defaultValue: [],
  });

  protected readonly wedding = computed(() => this.weddings.value()[0]);

  protected toggle(vendor: VendorSearchResult): void {
    const next = new Map(this.selected());
    if (next.has(vendor.id)) next.delete(vendor.id);
    else if (next.size < MAX_ENQUIRY_VENDORS) next.set(vendor.id, vendor);
    this.selected.set(next);
  }

  /**
   * Raises the enquiry. A customer with no wedding yet is sent to set one up
   * rather than being shown a validation error about a concept they have not
   * met - the enquiry needs a wedding to hang off.
   */
  protected async sendEnquiry(): Promise<void> {
    const wedding = this.wedding();
    if (!wedding) {
      await this.router.navigate(['/customer/wedding'], {
        queryParams: { next: 'vendors' },
      });
      return;
    }
    if (!this.date()) {
      this.error.set('Pick the function date before sending an enquiry.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const enquiry = await this.api.createEnquiry({
        weddingId: wedding.id,
        category: this.category(),
        functionType: this.functionForCategory(),
        functionDate: new Date(this.date()).toISOString(),
        guestCount: wedding.guestEstimate,
        vendorIds: [...this.selected().keys()],
      });
      this.selected.set(new Map());
      await this.router.navigate(['/customer/enquiries', enquiry.id]);
    } catch (e) {
      this.error.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Which function the enquiry is for. The wedding day itself is the sensible
   * default; per-function planning arrives with the wedding planner screen.
   */
  private functionForCategory(): FunctionType {
    return FUNCTIONS.includes('WEDDING') ? 'WEDDING' : FUNCTIONS[0]!;
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as never);
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  protected readonly formatEventDate = formatEventDate;

  protected readonly perUnit = (model: string): string =>
    ({
      PER_DAY: 'per day',
      PER_PLATE: 'per plate',
      PER_PACKAGE: 'per package',
      PER_HOUR: 'per hour',
    })[model] ?? '';

  protected readonly responseLabel = (mins: number): string =>
    mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
}
