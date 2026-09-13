import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_GROUPS,
  CATEGORY_META,
  MOST_BOOKED,
  categorySlug,
  type VendorCategory,
} from '@eventhub/contracts';

import { CITIES } from '../data/cities';

/** Price ceilings in rupees, which is how a family says a budget out loud. */
const PRICE_BANDS: { label: string; max: number | null }[] = [
  { label: 'Any budget', max: null },
  { label: 'Under ₹50,000', max: 50_000 },
  { label: 'Under ₹1 lakh', max: 1_00_000 },
  { label: 'Under ₹3 lakh', max: 3_00_000 },
  { label: 'Under ₹5 lakh', max: 5_00_000 },
  { label: 'Under ₹10 lakh', max: 10_00_000 },
];

const RATINGS = [4.5, 4, 3.5, 3];

/**
 * The faceted filter rail, in the shape a shopper already knows.
 *
 * Modelled on the marketplace convention rather than invented: headings in
 * near-black, facets as plain rows you click, the current value in bold, and no
 * box around any of it. The card-with-form-controls it replaces looked tidy but
 * read as a settings dialog - every value needed a radio hunted down and
 * clicked, and nothing told you at a glance what was already narrowed.
 *
 * Three things follow from copying that convention properly:
 *
 * - The category list sits at the top, because on a marketplace the first
 *   question is "am I even in the right department?" and the answer has to be
 *   one click, not a trip back to a hub page.
 * - Ratings are drawn as stars with "& Up", because that is what the control
 *   means. "4.5 and above" in a radio list is the same filter described rather
 *   than shown.
 * - The price band list is followed by a min-max box with its own Go, since
 *   fixed bands never contain the number somebody actually has in mind.
 *
 * It is a component of its own so the page keeps its style budget and so the
 * same rail can be dropped beside any other result list later.
 */
@Component({
  selector: 'eh-filter-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <aside class="rail">
      <!-- Department, in marketplace terms: where am I, and what is next door. -->
      <section class="facet">
        <h2>Category</h2>
        <a class="up" routerLink="/vendors">‹ All categories</a>
        <p class="here">{{ meta().plural }}</p>

        @for (sibling of siblings(); track sibling) {
          <a
            class="opt"
            [routerLink]="['/vendors', slug(sibling)]"
            [queryParams]="carried()"
          >{{ label(sibling) }}</a>
        }
      </section>

      <section class="facet">
        <h2>City</h2>
        @for (c of cities; track c) {
          <button
            type="button"
            class="opt"
            [class.on]="city() === c"
            (click)="city.set(c)"
          >{{ c }}</button>
        }
      </section>

      <section class="facet">
        <h2>Avg. customer review</h2>
        @for (r of ratings; track r) {
          <button
            type="button"
            class="opt stars"
            [class.on]="minRating() === r"
            (click)="minRating.set(minRating() === r ? 0 : r)"
            [attr.aria-label]="r + ' stars and up'"
          >
            <span class="star" aria-hidden="true">
              <span class="off">★★★★★</span>
              <span class="lit" [style.width.%]="(r / 5) * 100">★★★★★</span>
            </span>
            <span class="andup">&amp; Up</span>
          </button>
        }
        @if (minRating() > 0) {
          <button type="button" class="undo" (click)="minRating.set(0)">
            Clear
          </button>
        }
      </section>

      <section class="facet">
        <h2>Price</h2>
        @for (band of priceBands; track band.label) {
          <button
            type="button"
            class="opt"
            [class.on]="maxPrice() === band.max"
            (click)="maxPrice.set(band.max)"
          >{{ band.label }}</button>
        }

        <!--
          The escape hatch from the bands above. A family with ₹75,000 in mind
          is served badly by a list that jumps from 50,000 to a lakh.
        -->
        <form class="custom" (submit)="$event.preventDefault(); applyCustom()">
          <input
            type="number"
            min="1000"
            step="1000"
            placeholder="Max ₹"
            aria-label="Maximum price in rupees"
            [value]="draft()"
            (input)="draft.set($any($event.target).value)"
          />
          <button type="submit" class="go">Go</button>
        </form>
      </section>

      <section class="facet">
        <h2>Guests</h2>
        <input
          class="wide"
          type="number"
          min="10"
          max="5000"
          step="50"
          [value]="guests()"
          (input)="setGuests($any($event.target).value)"
        />
        <p class="note">Prices are worked out for this many.</p>
      </section>

      <section class="facet">
        <h2>Free on</h2>
        <input
          class="wide"
          type="date"
          [value]="date()"
          (input)="date.set($any($event.target).value)"
        />
        <p class="note">Only vendors whose calendar is actually open.</p>
      </section>

      @if (activeFilters() > 0) {
        <button type="button" class="clearall" (click)="clear()">
          Clear {{ activeFilters() }}
          {{ activeFilters() === 1 ? 'filter' : 'filters' }}
        </button>
      }
    </aside>
  `,
  styles: `
    :host { display: block; }

    /*
     * Not sticky, deliberately. A sticky rail taller than the viewport pins its
     * own overflow off-screen and the bottom filters become unreachable - which
     * is exactly what happened on the matrimony search page. It scrolls with
     * the page instead.
     */
    .rail { font-size: 0.82rem; line-height: 1.45; padding-right: 0.5rem; }

    .facet { padding: 0 0 0.9rem; margin-bottom: 0.9rem;
             border-bottom: 1px solid var(--brand-line); }
    .facet:last-of-type { border-bottom: none; }

    h2 { margin: 0 0 0.4rem; font-size: 0.86rem; font-weight: 700;
         color: var(--brand-ink); }

    /* One row per facet value: the whole row is the target, not a 13px radio. */
    .opt { display: block; width: 100%; text-align: left; border: none;
           background: none; font: inherit; cursor: pointer;
           padding: 0.16rem 0; color: rgb(0 0 0 / 0.75);
           text-decoration: none; border-radius: 3px; }
    .opt:hover { color: var(--brand); text-decoration: underline; }
    .opt.on { font-weight: 700; color: var(--brand-deep); }
    .opt:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }

    .up { display: block; font-size: 0.78rem; color: var(--brand);
          text-decoration: none; padding-bottom: 0.1rem; }
    .up:hover { text-decoration: underline; }
    .here { margin: 0 0 0.25rem; font-weight: 700; color: var(--brand-deep); }

    /*
     * Two copies of the same five glyphs, the lit one clipped to a percentage.
     * It keeps half-stars exact without a sprite or an icon font, and the
     * fallback if the clip fails is five grey stars rather than nothing.
     */
    .stars { display: flex; align-items: center; gap: 0.4rem; }
    .star { position: relative; display: inline-block; white-space: nowrap;
            letter-spacing: 0.06em; }
    .off { color: rgb(0 0 0 / 0.22); }
    .lit { position: absolute; left: 0; top: 0; overflow: hidden;
           color: var(--star); }
    .andup { font-size: 0.78rem; color: rgb(0 0 0 / 0.6); }
    .opt.on .andup { color: var(--brand-deep); }

    .undo { border: none; background: none; font: inherit; font-size: 0.76rem;
            color: var(--brand); cursor: pointer; padding: 0.2rem 0 0;
            text-decoration: underline; }

    .custom { display: flex; gap: 0.35rem; margin-top: 0.5rem; }
    .custom input { min-width: 0; flex: 1 1 auto; }
    input { font: inherit; font-size: 0.82rem; padding: 0.35rem 0.45rem;
            border: 1px solid rgb(0 0 0 / 0.28); border-radius: 6px;
            background: #fff; color: inherit; }
    input:focus-visible { outline: 2px solid var(--brand); outline-offset: 0; }
    .wide { width: 100%; box-sizing: border-box; }

    .go { flex: none; border: 1px solid var(--brand-line); border-radius: 6px;
          background: var(--brand-tint); color: var(--brand-deep);
          font: inherit; font-size: 0.78rem; font-weight: 700;
          padding: 0 0.6rem; cursor: pointer; }
    .go:hover { background: var(--brand); color: #fff; border-color: var(--brand); }

    .note { margin: 0.3rem 0 0; font-size: 0.72rem; color: rgb(0 0 0 / 0.5); }

    .clearall { border: 1px solid var(--brand); border-radius: 999px;
                background: none; color: var(--brand); font: inherit;
                font-size: 0.78rem; font-weight: 600; cursor: pointer;
                padding: 0.35rem 0.8rem; }
    .clearall:hover { background: var(--brand); color: #fff; }

  `,
})
export class FilterRail {
  /** The category being listed, so the rail can show where it sits. */
  readonly category = input.required<VendorCategory>();
  readonly activeFilters = input(0);

  readonly city = model.required<string>();
  readonly guests = model.required<number>();
  readonly maxPrice = model.required<number | null>();
  readonly minRating = model.required<number>();
  readonly date = model.required<string>();

  protected readonly cities = CITIES;
  protected readonly priceBands = PRICE_BANDS;
  protected readonly ratings = RATINGS;
  protected readonly slug = categorySlug;

  protected readonly meta = computed(() => CATEGORY_META[this.category()]);

  /**
   * The other categories worth a look from here.
   *
   * Normally the rest of the band this one sits in. Venues and Photo and video
   * are bands of one, though, and they are also the two pages people land on
   * most - so rather than leave the busiest rail ending in a dead heading, they
   * fall back to what families book first. A facet that lists nothing is worse
   * than no facet.
   */
  protected readonly siblings = computed(() => {
    const mine = this.category();
    const group = CATEGORY_GROUPS.find((g) => g.categories.includes(mine));
    const within = (group?.categories ?? []).filter((c) => c !== mine);
    return within.length ? within : MOST_BOOKED.filter((c) => c !== mine);
  });

  /**
   * The filters that should survive a hop to a neighbouring category. City and
   * guest count describe the wedding, not the category, so losing them on every
   * sideways move is how a shopper ends up re-entering the same two facts.
   */
  protected readonly carried = computed(() => ({
    city: this.city(),
    guests: this.guests(),
  }));

  /** Free text for the custom maximum, committed only on Go. */
  protected readonly draft = model('', { alias: 'priceDraft' });

  protected label(category: VendorCategory): string {
    return CATEGORY_META[category].plural;
  }

  protected applyCustom(): void {
    const n = Number(this.draft());
    // An empty or nonsense box clears the ceiling rather than filtering to zero.
    this.maxPrice.set(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  }

  protected setGuests(value: string): void {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) this.guests.set(Math.min(5000, Math.round(n)));
  }

  protected clear(): void {
    this.maxPrice.set(null);
    this.minRating.set(0);
    this.date.set('');
    this.draft.set('');
  }
}
