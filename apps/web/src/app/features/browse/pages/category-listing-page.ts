import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import {
  CATEGORY_META,
  categoryFromSlug,
  categorySlug,
  formatInr,
  type Paisa,
  type VendorCategory,
  type VendorSearchResult,
} from '@eventhub/contracts';

import { CITIES } from '../data/cities';
import { BrowseCard } from '../components/browse-card';

/** Price bands in rupees, which is how a family says a budget out loud. */
const PRICE_BANDS: { label: string; max: number | null }[] = [
  { label: 'Any budget', max: null },
  { label: 'Under ₹50,000', max: 50_000 },
  { label: 'Under ₹1 lakh', max: 1_00_000 },
  { label: 'Under ₹3 lakh', max: 3_00_000 },
  { label: 'Under ₹5 lakh', max: 5_00_000 },
  { label: 'Under ₹10 lakh', max: 10_00_000 },
];

/**
 * One category's vendors, with the filters down the side.
 *
 * A rail rather than a row of dropdowns: on a listing page the filters are the
 * second most important thing after the results, and a family narrowing a
 * search wants to see what they have already narrowed without opening anything.
 *
 * Every filter is in the URL. A shortlist gets shared in a family WhatsApp
 * group, and a link that loses the guest count and the budget arrives at
 * somebody's phone showing a different set of vendors than the person sending
 * it was looking at.
 */
@Component({
  selector: 'eh-category-listing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BrowseCard],
  template: `
    <main class="wrap">
      <nav class="crumbs">
        <a routerLink="/vendors">All categories</a>
        <span aria-hidden="true">›</span>
        <span>{{ meta().plural }}</span>
      </nav>

      <header class="head">
        <div>
          <h1>
            <span class="glyph" aria-hidden="true">{{ meta().glyph }}</span>
            {{ meta().plural }} in {{ city() }}
          </h1>
          <p class="blurb">{{ meta().blurb }}</p>
        </div>
        <p class="tally">
          @if (results.isLoading()) {
            Searching…
          } @else {
            <strong>{{ vendors().length }}</strong>
            {{ vendors().length === 1 ? 'vendor' : 'vendors' }}
            @if (activeFilters() > 0) {
              match your filters
            }
          }
        </p>
      </header>

      <div class="layout">
        <aside class="rail">
          <div class="filter">
            <h2>City</h2>
            <select [value]="city()" (change)="city.set($any($event.target).value)">
              @for (c of cities; track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
          </div>

          <div class="filter">
            <h2>Guests</h2>
            <input
              type="number"
              min="10"
              max="5000"
              step="50"
              [value]="guests()"
              (input)="setGuests($any($event.target).value)"
            />
            <p class="note">Prices below are worked out for this many.</p>
          </div>

          <div class="filter">
            <h2>Budget for this vendor</h2>
            @for (band of priceBands; track band.label) {
              <label class="radio">
                <input
                  type="radio"
                  name="price"
                  [checked]="maxPrice() === band.max"
                  (change)="maxPrice.set(band.max)"
                />
                <span>{{ band.label }}</span>
              </label>
            }
          </div>

          <div class="filter">
            <h2>Rating</h2>
            @for (r of ratings; track r.value) {
              <label class="radio">
                <input
                  type="radio"
                  name="rating"
                  [checked]="minRating() === r.value"
                  (change)="minRating.set(r.value)"
                />
                <span>{{ r.label }}</span>
              </label>
            }
          </div>

          <div class="filter">
            <h2>Free on</h2>
            <input type="date" [value]="date()" (input)="date.set($any($event.target).value)" />
            <p class="note">Only vendors whose calendar is actually open.</p>
          </div>

          @if (activeFilters() > 0) {
            <button type="button" class="clear" (click)="clearFilters()">
              Clear {{ activeFilters() }}
              {{ activeFilters() === 1 ? 'filter' : 'filters' }}
            </button>
          }
        </aside>

        <section class="results">
          <div class="sortbar">
            <label>
              Sort by
              <select [value]="sort()" (change)="sort.set($any($event.target).value)">
                <option value="rating">Rating</option>
                <option value="price">Price, lowest first</option>
                <option value="response">Fastest to reply</option>
              </select>
            </label>
          </div>

          @if (results.isLoading()) {
            <div class="skeletons">
              @for (i of [1, 2, 3, 4, 5, 6]; track i) {
                <div class="skeleton"></div>
              }
            </div>
          } @else {
            <div class="grid">
              @for (vendor of vendors(); track vendor.id) {
                <eh-browse-card
                  [vendor]="vendor"
                  [guestCount]="guests()"
                  [category]="categoryEnum()"
                />
              } @empty {
                <!--
                  The category name is deliberately not dropped into the middle
                  of this sentence. Some of them are mass nouns - "there are no
                  honeymoon in Chennai" - and no amount of pluralising rescues
                  a sentence built around whichever noun happens to be next.
                -->
                <section class="empty">
                  <h2>Nothing here yet</h2>
                  <p>
                    @if (activeFilters() > 0) {
                      No {{ meta().plural }} in {{ city() }} meet all of your
                      filters. Try widening the budget or the rating.
                    } @else {
                      {{ meta().plural }} — {{ city() }}. Nobody in this
                      category has listed here yet.
                    }
                  </p>
                  @if (activeFilters() > 0) {
                    <button type="button" class="clear" (click)="clearFilters()">
                      Clear filters
                    </button>
                  }
                  <a class="alt" routerLink="/vendors">Browse another category</a>
                </section>
              }
            </div>
          }
        </section>
      </div>
    </main>
  `,
  styles: `
    .wrap { max-width: 1200px; margin: 0 auto; padding: 1rem 1rem 4rem; }

    .crumbs { display: flex; gap: 0.4rem; align-items: center; font-size: 0.78rem;
              color: rgb(0 0 0 / 0.45); margin-bottom: 0.7rem; }
    .crumbs a { color: #2f2d78; text-decoration: none; }
    .crumbs a:hover { text-decoration: underline; }

    .head { display: flex; align-items: flex-end; justify-content: space-between;
            gap: 1rem; flex-wrap: wrap; padding-bottom: 0.9rem;
            border-bottom: 1px solid rgb(0 0 0 / 0.08); margin-bottom: 1.1rem; }
    h1 { margin: 0; font-size: 1.55rem; color: #23214f; display: flex;
         align-items: center; gap: 0.5rem; }
    .glyph { width: 2.2rem; height: 2.2rem; display: grid; place-items: center;
             font-size: 1.1rem; border-radius: 50%;
             background: linear-gradient(135deg, rgb(232 163 61 / 0.22),
                                                 rgb(47 45 120 / 0.12)); }
    .blurb { margin: 0.35rem 0 0; font-size: 0.87rem; color: rgb(0 0 0 / 0.6);
             max-width: 60ch; }
    .tally { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .tally strong { color: #23214f; font-size: 1rem; }

    .layout { display: grid; grid-template-columns: 224px 1fr; gap: 1.4rem;
              align-items: start; }

    .rail { position: sticky; top: 1rem; display: flex; flex-direction: column;
            gap: 1rem; padding: 1rem; border: 1px solid rgb(0 0 0 / 0.1);
            border-radius: 12px; background: #fff; }
    .filter h2 { margin: 0 0 0.4rem; font-size: 0.72rem; font-weight: 700;
                 letter-spacing: 0.07em; text-transform: uppercase;
                 color: rgb(0 0 0 / 0.45); }
    .filter select, .filter input[type='number'], .filter input[type='date'] {
      font: inherit; font-size: 0.85rem; width: 100%; padding: 0.4rem 0.5rem;
      border: 1px solid rgb(0 0 0 / 0.2); border-radius: 7px; background: #fff; }
    .note { margin: 0.3rem 0 0; font-size: 0.7rem; color: rgb(0 0 0 / 0.45);
            line-height: 1.4; }
    .radio { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem;
             padding: 0.15rem 0; cursor: pointer; color: rgb(0 0 0 / 0.75); }
    .clear { font: inherit; font-size: 0.8rem; font-weight: 600; color: #2f2d78;
             background: none; border: 1px solid rgb(47 45 120 / 0.35);
             border-radius: 7px; padding: 0.4rem 0.6rem; cursor: pointer; }
    .clear:hover { background: rgb(47 45 120 / 0.06); }

    .sortbar { display: flex; justify-content: flex-end; margin-bottom: 0.7rem;
               font-size: 0.8rem; color: rgb(0 0 0 / 0.6); }
    .sortbar select { font: inherit; font-size: 0.82rem; margin-left: 0.35rem;
                      padding: 0.3rem 0.4rem; border: 1px solid rgb(0 0 0 / 0.2);
                      border-radius: 7px; background: #fff; }

    .grid, .skeletons { display: grid; gap: 0.9rem;
                        grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); }
    .skeleton { height: 380px; border-radius: 12px;
                background: linear-gradient(100deg, rgb(0 0 0 / 0.05) 30%,
                                            rgb(0 0 0 / 0.09) 50%, rgb(0 0 0 / 0.05) 70%);
                background-size: 200% 100%; animation: shimmer 1.3s linear infinite; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }

    .empty { grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem;
             border: 1px dashed rgb(0 0 0 / 0.18); border-radius: 12px; }
    .empty h2 { margin: 0 0 0.4rem; font-size: 1.05rem; }
    .empty p { margin: 0 0 0.9rem; font-size: 0.87rem; color: rgb(0 0 0 / 0.6); }
    .alt { display: inline-block; margin-left: 0.6rem; font-size: 0.83rem;
           color: #2f2d78; }

    @media (max-width: 860px) {
      .layout { grid-template-columns: 1fr; }
      .rail { position: static; }
    }
  `,
})
export class CategoryListingPage {
  private readonly router = inject(Router);

  /** From the route, via withComponentInputBinding(). */
  /** The :category route segment, via withComponentInputBinding(). */
  readonly category = input.required<string>();

  protected readonly cities = CITIES;
  protected readonly priceBands = PRICE_BANDS;
  protected readonly ratings = [
    { label: 'Any rating', value: 0 },
    { label: '4.5 and above', value: 4.5 },
    { label: '4.0 and above', value: 4 },
    { label: '3.5 and above', value: 3.5 },
  ];

  protected readonly city = signal<string>(CITIES[0]);
  protected readonly guests = signal(200);
  protected readonly maxPrice = signal<number | null>(null);
  protected readonly minRating = signal(0);
  protected readonly date = signal('');
  protected readonly sort = signal<'rating' | 'price' | 'response'>('rating');

  /** An unknown slug falls back to venues rather than rendering nothing. */
  protected readonly categoryEnum = computed<VendorCategory>(
    () => categoryFromSlug(this.category()) ?? 'VENUE',
  );
  protected readonly meta = computed(() => CATEGORY_META[this.categoryEnum()]);

  constructor() {
    // Read once, from the snapshot, rather than in an effect.
    //
    // As an effect this raced the one below: whichever ran first won, and when
    // the writer won it replaced the URL with the default city before the
    // reader had seen the real one. A link to Chennai then landed on
    // Hyderabad, which is the sort of bug that looks like bad data.
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const startCity = params.get('city');
    if (startCity && (CITIES as readonly string[]).includes(startCity)) {
      this.city.set(startCity);
    }
    const startGuests = Number(params.get('guests'));
    if (Number.isFinite(startGuests) && startGuests > 0) {
      this.guests.set(Math.min(5000, Math.round(startGuests)));
    }
    const startSort = params.get('sort');
    if (startSort === 'rating' || startSort === 'price' || startSort === 'response') {
      this.sort.set(startSort);
    }
    const startMax = Number(params.get('maxPrice'));
    if (Number.isFinite(startMax) && startMax > 0) this.maxPrice.set(startMax);
    const startRating = Number(params.get('minRating'));
    if (Number.isFinite(startRating) && startRating > 0) this.minRating.set(startRating);
    const startDate = params.get('date');
    if (startDate) this.date.set(startDate);

    // Filters live in the URL so the page can be shared and reloaded intact.
    effect(() => {
      const params: Record<string, string | number | undefined> = {
        city: this.city(),
        guests: this.guests(),
        sort: this.sort(),
        maxPrice: this.maxPrice() ?? undefined,
        minRating: this.minRating() || undefined,
        date: this.date() || undefined,
      };
      void this.router.navigate([], {
        queryParams: params,
        replaceUrl: true,
      });
    });
  }

  protected readonly results = httpResource<VendorSearchResult[]>(
    () => {
      const params = new URLSearchParams({
        category: this.categoryEnum(),
        city: this.city(),
        sort: this.sort(),
      });
      // Paisa at the boundary: the rail speaks rupees, the API speaks paisa.
      const max = this.maxPrice();
      if (max !== null) params.set('maxPrice', String(max * 100));
      if (this.minRating() > 0) params.set('minRating', String(this.minRating()));
      if (this.date()) params.set('date', this.date());
      return `/api/v1/vendors/search?${params.toString()}`;
    },
    {
      parse: (raw) => (raw as { data: VendorSearchResult[] }).data,
      defaultValue: [],
    },
  );

  protected readonly vendors = computed(() => this.results.value());

  /** Filters beyond the city, which is always set and so never "active". */
  protected readonly activeFilters = computed(
    () =>
      (this.maxPrice() !== null ? 1 : 0) +
      (this.minRating() > 0 ? 1 : 0) +
      (this.date() ? 1 : 0),
  );

  protected setGuests(value: string): void {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) this.guests.set(Math.min(5000, Math.round(n)));
  }

  protected clearFilters(): void {
    this.maxPrice.set(null);
    this.minRating.set(0);
    this.date.set('');
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly slug = categorySlug;
}
