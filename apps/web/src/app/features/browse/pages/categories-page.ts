import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import {
  ALL_CATEGORIES,
  CATEGORY_GROUPS,
  CATEGORY_META,
  categorySlug,
  formatInr,
  type CategoryTile,
  type Paisa,
  type VendorCategory,
} from '@eventhub/contracts';

import { CITIES } from '../data/cities';
import { WeddingMasthead } from '../../../core/components/wedding-masthead';
import { HERO_IMAGE } from '../../home/components/home-hero';

/** The categories carried at the top, above the bands, as big photo cards. */
const HEADLINE: VendorCategory[] = [
  'VENUE',
  'PHOTOGRAPHY',
  'CATERING',
  'MAKEUP',
] as VendorCategory[];

/**
 * The front door of the marketplace.
 *
 * Every wedding site worth using opens on the categories, because a family
 * arrives knowing they need a mandap and a caterer and not knowing the name of
 * a single company. The old front door was a three-step enquiry form, which
 * asks somebody to commit to a shortlist before they have seen that a
 * shortlist is possible.
 *
 * Photo-led, following the reference the marketplace is being built against.
 * The picture is not decoration here: a family choosing between "Decor" and
 * "Venues" is choosing what they want the day to look like, and nineteen text
 * labels give them nothing to choose with. Each tile carries the cover photo of
 * the best-rated vendor in that category, so what is on the tile is work by
 * somebody actually bookable rather than stock scenery.
 *
 * Four headline categories first, at full size, because a wedding is planned in
 * that order and a grid with no entry point is a list. The rest stay in their
 * bands underneath, tighter, for the family who already knows they came for
 * mehendi.
 *
 * The counts are live, and a tile that has nothing says so. A category tile
 * that promises vendors and opens onto an empty page is worse than one that
 * admits it up front.
 */
@Component({
  selector: 'eh-categories-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WeddingMasthead],
  template: `
    <eh-wedding-masthead context="wedding" />

    <!--
      The same hero the enquiry page carries, so the two public marketplace
      routes read as one product. Its backdrop is the wedding photograph shipped
      with the app, under a near-neutral scrim that darkens it for legibility
      without draining its colour.
    -->
    <section class="hero">
      @if (heroShot(); as url) {
        <img class="heroShot" [src]="url" alt="" fetchpriority="high" />
      }

      <div class="heroInner">
        <h1>Everything you need to book</h1>
        <p class="lede">
          Verified vendors across {{ totalCategories }} categories. Compare real
          prices for your guest count, read reviews written by couples who
          actually booked, and ask up to five of them at once.
        </p>

        <form class="searchbar" (submit)="$event.preventDefault(); go()">
          <label class="field">
            <span>Vendor type</span>
            <select [value]="pick()" (change)="pick.set($any($event.target).value)">
              @for (c of allCategories; track c) {
                <option [value]="c" [selected]="c === pick()">{{ meta(c).plural }}</option>
              }
            </select>
          </label>

          <label class="field">
            <span>City</span>
            <select [value]="city()" (change)="city.set($any($event.target).value)">
              @for (c of cities; track c) {
                <option [value]="c" [selected]="c === city()">{{ c }}</option>
              }
            </select>
          </label>

          <button type="submit" class="getstarted">Get started</button>
        </form>
      </div>
    </section>

    <main class="wrap">
      <section class="headline">
        @for (category of headline; track category) {
          <a
            class="card"
            [routerLink]="['/vendors', slug(category)]"
            [queryParams]="{ city: city() }"
          >
            <span class="shot">
              @if (tile(category); as t) {
                @if (t.coverUrl) {
                  <img [src]="t.coverUrl" alt="" loading="lazy" />
                } @else {
                  <span class="fallback" aria-hidden="true">{{ meta(category).glyph }}</span>
                }
              } @else {
                <span class="fallback" aria-hidden="true">{{ meta(category).glyph }}</span>
              }
            </span>
            <span class="over">
              <strong>{{ meta(category).plural }}</strong>
              <span class="sub">{{ supply(category) }}</span>
            </span>
          </a>
        }
      </section>

      @for (band of groups; track band.group) {
        <section class="band">
          <h2>{{ band.group }}</h2>
          <div class="tiles">
            @for (category of band.categories; track category) {
              <a
                class="tile"
                [class.empty]="countFor(category) === 0"
                [routerLink]="['/vendors', slug(category)]"
                [queryParams]="{ city: city() }"
              >
                <span class="thumb">
                  @if (coverFor(category); as url) {
                    <img [src]="url" alt="" loading="lazy" />
                  } @else {
                    <span class="fallback small" aria-hidden="true">
                      {{ meta(category).glyph }}
                    </span>
                  }
                </span>

                <span class="text">
                  <span class="name">{{ meta(category).plural }}</span>
                  <span class="blurb">{{ meta(category).blurb }}</span>
                  <span class="foot">
                    <span class="count" [class.none]="countFor(category) === 0">
                      @if (tiles.isLoading()) {
                        &nbsp;
                      } @else if (countFor(category) > 0) {
                        {{ countFor(category) }} in {{ city() }}
                      } @else {
                        None in {{ city() }} yet
                      }
                    </span>
                    @if (priceFor(category); as price) {
                      <span class="from">from {{ inr(price) }}</span>
                    }
                  </span>
                </span>
              </a>
            }
          </div>
        </section>
      }
    </main>
  `,
  styles: `
    :host { display: block; --pink: var(--brand); --pinkHover: var(--brand-deep); }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 1.75rem 1rem 4rem; }

    .hero { position: relative; display: grid; place-items: center;
            min-height: clamp(15rem, 32vw, 21rem); overflow: hidden;
            background: linear-gradient(160deg, var(--brand-deep) 0%, var(--brand-deep) 100%); }
    .heroShot { position: absolute; inset: 0; width: 100%; height: 100%;
                object-fit: cover; }
    .hero::after { content: ''; position: absolute; inset: 0;
                   background: linear-gradient(to bottom, rgb(var(--scrim-rgb) / 0.58) 0%,
                                                          rgb(var(--scrim-rgb) / 0.52) 45%,
                                                          rgb(var(--scrim-rgb) / 0.88) 100%); }
    .heroInner { position: relative; z-index: 1; width: 100%; max-width: 62rem;
                 box-sizing: border-box; text-align: center; color: #fff;
                 padding: clamp(1.8rem, 4vw, 3rem) clamp(1rem, 4vw, 2rem); }
    h1 { margin: 0; font-size: clamp(1.7rem, 4.4vw, 2.9rem); font-weight: 800;
         letter-spacing: -0.025em; line-height: 1.1;
         text-shadow: 0 2px 18px rgb(0 0 0 / 0.35); }
    .lede { margin: 0.7rem auto 0; max-width: 58ch; font-size: clamp(0.92rem, 1.5vw, 1.05rem);
            line-height: 1.6; opacity: 0.95; text-shadow: 0 1px 12px rgb(0 0 0 / 0.35); }

    .searchbar { display: grid; grid-template-columns: 1.2fr 1fr auto; align-items: stretch;
                 margin: clamp(1.2rem, 3vw, 1.8rem) auto 0; max-width: 44rem;
                 background: #fff; border-radius: 10px; overflow: hidden;
                 box-shadow: 0 12px 34px rgb(0 0 0 / 0.28); }
    .field { display: flex; flex-direction: column; justify-content: center; gap: 0.1rem;
             text-align: left; padding: 0.55rem 0.9rem;
             border-right: 1px solid rgb(0 0 0 / 0.1); }
    .field > span { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.07em;
                    text-transform: uppercase; color: rgb(0 0 0 / 0.45); }
    .field select { font: inherit; font-size: 0.98rem; border: 0; padding: 0.15rem 0;
                    background: transparent; color: rgb(0 0 0 / 0.87); width: 100%; }
    .field select:focus { outline: none; }
    .getstarted { font: inherit; font-size: 1rem; font-weight: 700; cursor: pointer;
                  border: 0; background: var(--pink); color: #fff;
                  padding: 0 clamp(1.4rem, 3vw, 2.4rem); white-space: nowrap;
                  transition: background 120ms ease; }
    .getstarted:hover { background: var(--pinkHover); }

    /* ------------------------------------------------------- headline cards */

    .headline { display: grid; gap: 0.9rem; margin-bottom: 2.4rem;
                grid-template-columns: repeat(4, 1fr); }
    .card { position: relative; display: block; overflow: hidden; border-radius: 14px;
            text-decoration: none; color: #fff; aspect-ratio: 4 / 3;
            background: var(--brand-deep);
            transition: transform 140ms ease, box-shadow 140ms ease; }
    .card:hover, .card:focus-visible { transform: translateY(-3px);
            box-shadow: 0 14px 30px rgb(var(--brand-deep-rgb) / 0.26); }
    .shot { position: absolute; inset: 0; display: block; }
    .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
    /* The scrim is what keeps the label legible over an unknown photograph. */
    .card::after { content: ''; position: absolute; inset: 0;
                   background: linear-gradient(to top, rgb(var(--scrim-rgb) / 0.82) 0%,
                                                       rgb(var(--scrim-rgb) / 0.25) 45%,
                                                       transparent 72%); }
    .over { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1;
            display: flex; flex-direction: column; gap: 0.15rem;
            padding: 0.9rem 1rem; }
    .over strong { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.01em; }
    .sub { font-size: 0.79rem; opacity: 0.88; }

    .fallback { position: absolute; inset: 0; display: grid; place-items: center;
                font-size: 3rem;
                background: linear-gradient(135deg, var(--brand-light) 0%, var(--brand-deep) 100%); }
    .fallback.small { font-size: 1.5rem; border-radius: 10px; }

    /* -------------------------------------------------------- banded tiles */

    .band { margin-bottom: 1.9rem; }
    .band h2 { margin: 0 0 0.75rem; font-size: 0.78rem; font-weight: 700;
               letter-spacing: 0.09em; text-transform: uppercase;
               color: rgb(0 0 0 / 0.42); }

    .tiles { display: grid; gap: 0.8rem;
             grid-template-columns: repeat(auto-fill, minmax(255px, 1fr)); }

    .tile { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.85rem;
            text-decoration: none; padding: 0.7rem; color: inherit;
            border: 1px solid rgb(0 0 0 / 0.1); border-radius: 12px; background: #fff;
            transition: transform 120ms ease, box-shadow 120ms ease,
                        border-color 120ms ease; }
    .tile:hover, .tile:focus-visible { transform: translateY(-2px); border-color: var(--brand);
                  box-shadow: 0 10px 24px rgb(var(--brand-rgb) / 0.12); }
    .tile.empty { opacity: 0.62; }

    .thumb { position: relative; width: 5.5rem; height: 5.5rem; border-radius: 10px;
             overflow: hidden; background: #efeef6; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .text { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
    .name { font-size: 0.98rem; font-weight: 600; color: var(--brand-deep); }
    .blurb { font-size: 0.78rem; line-height: 1.42; color: rgb(0 0 0 / 0.58);
             flex: 1;
             /* Two lines, so a long blurb cannot make one tile taller than the
                rest of its row. */
             display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
             overflow: hidden; }
    .foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem;
            margin-top: 0.3rem; }
    .count { font-size: 0.74rem; font-weight: 600; color: #1b5e20; }
    .count.none { color: rgb(0 0 0 / 0.38); font-weight: 400; }
    .from { font-size: 0.74rem; font-weight: 600; color: rgb(0 0 0 / 0.55); }

    @media (max-width: 980px) {
      .headline { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 700px) {
      .searchbar { grid-template-columns: 1fr; }
      .field { border-right: 0; border-bottom: 1px solid rgb(0 0 0 / 0.1); }
      .getstarted { padding: 0.85rem 1rem; }
    }
    @media (max-width: 560px) {
      .headline { gap: 0.6rem; }
      .card { aspect-ratio: 3 / 2; }
      .over strong { font-size: 0.95rem; }
      .tiles { grid-template-columns: 1fr; }
      .blurb { display: none; }
    }
  `,
})
export class CategoriesPage {
  protected readonly groups = CATEGORY_GROUPS;
  protected readonly cities = CITIES;
  protected readonly headline = HEADLINE;
  protected readonly totalCategories = Object.keys(CATEGORY_META).length;

  protected readonly city = signal(CITIES[0]);

  private readonly router = inject(Router);

  protected readonly allCategories = ALL_CATEGORIES;
  /** What the hero's vendor-type select is on. Separate from the tiles below. */
  protected readonly pick = signal<VendorCategory>(HEADLINE[0]);

  protected go(): void {
    void this.router.navigate(['/vendors', categorySlug(this.pick())], {
      queryParams: { city: this.city() },
    });
  }

  /**
   * The hero backdrop: the wedding photograph shipped with the app.
   *
   * It used to be whichever category happened to have a cover shot, which meant
   * the top of the page changed with the seed data and was usually a vendor
   * photo never composed to carry a headline. See public/hero/README.md.
   */
  protected readonly heroShot = signal(HERO_IMAGE);

  /**
   * What each category has to show, in the chosen city.
   *
   * One request for the whole page. Nineteen tiles each fetching their own
   * count and cover would be nineteen round trips to render a menu.
   */
  protected readonly tiles = httpResource<CategoryTile[]>(
    () => `/api/v1/vendors/category-counts?city=${encodeURIComponent(this.city())}`,
    {
      parse: (raw) => (raw as { data: CategoryTile[] }).data,
      defaultValue: [],
    },
  );

  private readonly byCategory = computed(() => {
    const map = new Map<string, CategoryTile>();
    for (const row of this.tiles.value()) map.set(row.category, row);
    return map;
  });

  protected tile(category: VendorCategory): CategoryTile | undefined {
    return this.byCategory().get(category);
  }

  protected countFor(category: VendorCategory): number {
    return this.byCategory().get(category)?.count ?? 0;
  }

  protected coverFor(category: VendorCategory): string | null {
    return this.byCategory().get(category)?.coverUrl ?? null;
  }

  protected priceFor(category: VendorCategory): Paisa | null {
    return (this.byCategory().get(category)?.priceFrom ?? null) as Paisa | null;
  }

  /** The line under a headline card: supply first, price only if there is any. */
  protected supply(category: VendorCategory): string {
    if (this.tiles.isLoading()) return ' ';

    const count = this.countFor(category);
    if (count === 0) return `None in ${this.city()} yet`;

    const price = this.priceFor(category);
    const many = `${count} in ${this.city()}`;
    return price ? `${many} · from ${formatInr(price)}` : many;
  }

  protected inr(price: Paisa): string {
    return formatInr(price);
  }

  protected meta(category: VendorCategory) {
    return CATEGORY_META[category];
  }

  protected slug(category: VendorCategory): string {
    return categorySlug(category);
  }
}
