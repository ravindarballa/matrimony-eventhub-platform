import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import {
  CATEGORY_GROUPS,
  CATEGORY_META,
  categorySlug,
  type VendorCategory,
} from '@eventhub/contracts';

import { CITIES } from '../data/cities';

interface CategoryCount {
  category: VendorCategory;
  count: number;
}

/**
 * The front door of the marketplace.
 *
 * Every wedding site worth using opens on the categories, because a family
 * arrives knowing they need a mandap and a caterer and not knowing the name of
 * a single company. The old front door was a three-step enquiry form, which
 * asks somebody to commit to a shortlist before they have seen that a
 * shortlist is possible.
 *
 * Grouped into bands rather than listed as nineteen equal tiles. Nineteen
 * things in a grid is a list to be read; five bands of three or four is a shape
 * to be scanned, and the bands are the order a wedding is actually planned in -
 * the venue and the food first, because everything else waits on the date and
 * the headcount.
 *
 * The counts are live. A category tile that promises vendors and opens onto an
 * empty page is worse than one that says so up front.
 */
@Component({
  selector: 'eh-categories-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="wrap">
      <header class="hero">
        <h1>Everything you need to book</h1>
        <p class="lede">
          Verified vendors across {{ totalCategories }} categories. Compare real
          prices for your guest count, read reviews written by couples who
          actually booked, and ask up to five of them at once.
        </p>

        <label class="city">
          <span>Showing vendors in</span>
          <select [value]="city()" (change)="city.set($any($event.target).value)">
            @for (c of cities; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </label>
      </header>

      @for (band of groups; track band.group) {
        <section class="band">
          <h2>{{ band.group }}</h2>
          <div class="tiles">
            @for (category of band.categories; track category) {
              <a
                class="tile"
                [routerLink]="['/vendors', slug(category)]"
                [queryParams]="{ city: city() }"
              >
                <span class="glyph" aria-hidden="true">{{ meta(category).glyph }}</span>
                <span class="name">{{ meta(category).plural }}</span>
                <span class="blurb">{{ meta(category).blurb }}</span>
                <span class="count" [class.none]="countFor(category) === 0">
                  @if (counts.isLoading()) {
                    &nbsp;
                  } @else if (countFor(category) > 0) {
                    {{ countFor(category) }} in {{ city() }}
                  } @else {
                    None in {{ city() }} yet
                  }
                </span>
              </a>
            }
          </div>
        </section>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 1120px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }

    .hero { padding: 1.6rem 0 1.4rem; border-bottom: 1px solid rgb(0 0 0 / 0.08);
            margin-bottom: 1.4rem; }
    h1 { margin: 0; font-size: 2rem; letter-spacing: -0.01em; color: #23214f; }
    .lede { margin: 0.5rem 0 0; font-size: 0.95rem; line-height: 1.6;
            color: rgb(0 0 0 / 0.62); max-width: 62ch; }
    .city { display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem;
            font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .city select { font: inherit; font-size: 0.9rem; font-weight: 600; color: #2f2d78;
                   padding: 0.35rem 0.5rem; border: 1px solid rgb(0 0 0 / 0.2);
                   border-radius: 7px; background: #fff; }

    .band { margin-bottom: 1.8rem; }
    .band h2 { margin: 0 0 0.7rem; font-size: 0.78rem; font-weight: 700;
               letter-spacing: 0.09em; text-transform: uppercase;
               color: rgb(0 0 0 / 0.42); }

    .tiles { display: grid; gap: 0.8rem;
             grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }

    .tile { display: flex; flex-direction: column; gap: 0.25rem; text-decoration: none;
            padding: 1rem; border: 1px solid rgb(0 0 0 / 0.1); border-radius: 12px;
            background: #fff; color: inherit;
            transition: transform 120ms ease, box-shadow 120ms ease,
                        border-color 120ms ease; }
    .tile:hover { transform: translateY(-2px); border-color: #2f2d78;
                  box-shadow: 0 10px 24px rgb(47 45 120 / 0.12); }

    /* A tinted disc behind the glyph, so the tile reads as designed rather
       than as an emoji sitting on a white rectangle. */
    .glyph { width: 2.6rem; height: 2.6rem; display: grid; place-items: center;
             font-size: 1.35rem; border-radius: 50%; margin-bottom: 0.35rem;
             background: linear-gradient(135deg, rgb(232 163 61 / 0.22),
                                                 rgb(47 45 120 / 0.12)); }
    .name { font-size: 1rem; font-weight: 600; color: #23214f; }
    .blurb { font-size: 0.79rem; line-height: 1.45; color: rgb(0 0 0 / 0.58);
             flex: 1; }
    .count { margin-top: 0.5rem; font-size: 0.74rem; font-weight: 600;
             color: #1b5e20; }
    .count.none { color: rgb(0 0 0 / 0.38); font-weight: 400; }

    @media (max-width: 560px) {
      h1 { font-size: 1.5rem; }
      .tiles { grid-template-columns: 1fr 1fr; gap: 0.6rem; }
      .tile { padding: 0.75rem; }
      .blurb { display: none; }
    }
  `,
})
export class CategoriesPage {
  protected readonly groups = CATEGORY_GROUPS;
  protected readonly cities = CITIES;
  protected readonly totalCategories = Object.keys(CATEGORY_META).length;

  protected readonly city = signal(CITIES[0]);

  /**
   * How many bookable vendors each category has in the chosen city.
   *
   * One request for the whole page. Nineteen tiles each fetching their own
   * count would be nineteen round trips to render a menu.
   */
  protected readonly counts = httpResource<CategoryCount[]>(
    () => `/api/v1/vendors/category-counts?city=${encodeURIComponent(this.city())}`,
    {
      parse: (raw) => (raw as { data: CategoryCount[] }).data,
      defaultValue: [],
    },
  );

  private readonly byCategory = computed(() => {
    const map = new Map<string, number>();
    for (const row of this.counts.value()) map.set(row.category, row.count);
    return map;
  });

  protected countFor(category: VendorCategory): number {
    return this.byCategory().get(category) ?? 0;
  }

  protected meta(category: VendorCategory) {
    return CATEGORY_META[category];
  }

  protected slug(category: VendorCategory): string {
    return categorySlug(category);
  }
}
