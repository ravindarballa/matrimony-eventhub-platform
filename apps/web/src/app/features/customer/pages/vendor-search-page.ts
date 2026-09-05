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
      <header class="head">
        <h1>Find vendors</h1>
        <p class="sub">
          Only vendors free on your date are shown, so everything here is bookable.
        </p>
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

      @for (vendor of results.value(); track vendor.id) {
        <article class="card" [class.picked]="selected().has(vendor.id)">
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
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .filters { display: flex; gap: 0.75rem; flex-wrap: wrap;
               background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
               border-radius: 10px; padding: 0.9rem 1rem; }
    .filters label { display: flex; flex-direction: column; gap: 0.25rem;
                     font-size: 0.72rem; text-transform: uppercase;
                     letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .filters input, .filters select { font: inherit; font-size: 0.9rem;
                     padding: 0.4rem 0.5rem; border-radius: 6px;
                     border: 1px solid rgb(0 0 0 / 0.25); text-transform: none;
                     letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .tray { position: sticky; top: 4.5rem; z-index: 5;
            display: flex; align-items: center; justify-content: space-between;
            gap: 1rem; background: #2f2d78; color: #fff;
            padding: 0.7rem 1rem; border-radius: 10px; }
    .muted { opacity: 0.7; }
    .card { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: #fff;
            padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .card.picked { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }
    .row { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .meta { margin: 0.2rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .verified { color: #1b5e20; font-weight: 700; margin-left: 0.4rem; }
    .price { text-align: right; }
    .from { display: block; font-size: 0.7rem; color: rgb(0 0 0 / 0.5); }
    .price strong { font-variant-numeric: tabular-nums; }
    .desc { margin: 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.75); }
    .stats { display: flex; gap: 1rem; font-size: 0.8rem; color: rgb(0 0 0 / 0.55); flex-wrap: wrap; }
    .services { list-style: none; margin: 0; padding: 0.6rem 0 0;
                border-top: 1px solid rgb(0 0 0 / 0.08);
                display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
    .services li { display: flex; justify-content: space-between; gap: 1rem; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
    button { align-self: flex-start; }
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
