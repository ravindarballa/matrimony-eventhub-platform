import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import {
  CATEGORY_META,
  categorySlug,
  formatInr,
  type CategoryTile,
  type Paisa,
  type VendorCategory,
  type VendorSearchResult,
} from '@eventhub/contracts';

import { HomeHero } from '../components/home-hero';

/**
 * The categories a wedding actually gets booked from, in the order it happens.
 *
 * Nine of nineteen. The full list lives on /vendors; a landing page that prints
 * every category is a sitemap, and the point of this row is to be scannable in
 * one look.
 */
const SERVICES: VendorCategory[] = [
  'VENUE',
  'CATERING',
  'PHOTOGRAPHY',
  'DECOR',
  'MAKEUP',
  'MUSIC',
  'PANDIT',
  'TRANSPORT',
  'INVITATION',
] as VendorCategory[];

/**
 * The front door.
 *
 * Until recently `/` redirected straight to a login form, which asks a visitor
 * to commit before they have seen anything. This page earns the signup instead:
 * the partner search a matrimony visitor came for, and - because this platform
 * is two products - a way through to the wedding side for someone already
 * engaged who only wants quotes.
 *
 * Photo-led below the hero, following the marketplace reference. The categories
 * were nine drawn glyphs on white tiles, which is a menu; they are now the
 * cover photo of the best-rated vendor in each category, which is a shopfront.
 * Same links, but a family scrolling past can see what they would be buying.
 *
 * Everything on this page is real: the tiles' photographs, counts and prices
 * come from the same public endpoint the browse grid uses, and the featured row
 * is the top-rated bookable vendors. A landing page carrying invented supply is
 * a promise the search results then break.
 *
 * The hero is its own component; everything here is the explanation for people
 * the search box did not immediately convince.
 */
@Component({
  selector: 'eh-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, HomeHero],
  template: `
    <eh-home-hero />

    <section class="services">
      <header>
        <h2>Everything the wedding needs</h2>
        <p>
          Ask up to five vendors in one go and compare what they quote, side by
          side. No account needed to start.
        </p>
      </header>

      <div class="grid">
        @for (service of services; track service) {
          <a
            class="tile"
            [routerLink]="['/vendors', slug(service)]"
            [attr.aria-label]="meta(service).plural"
          >
            <span class="shot">
              @if (coverFor(service); as url) {
                <img [src]="url" alt="" loading="lazy" />
              } @else {
                <span class="fallback" aria-hidden="true">{{ meta(service).glyph }}</span>
              }
            </span>
            <span class="label">
              <strong>{{ meta(service).plural }}</strong>
              <span class="sub">{{ supply(service) }}</span>
            </span>
          </a>
        }
      </div>

      <a mat-flat-button class="wide" routerLink="/vendors">
        Browse all {{ totalCategories }} categories
      </a>
    </section>

    @if (featured().length) {
      <section class="featured">
        <header>
          <h2>Highest rated right now</h2>
          <p>Rated by families who booked them through this platform.</p>
        </header>

        <div class="row">
          @for (vendor of featured(); track vendor.id) {
            <a class="vcard" [routerLink]="['/vendors', slug(vendor.category), vendor.id]">
              <span class="vshot">
                @if (coverOf(vendor); as url) {
                  <img [src]="url" [alt]="vendor.businessName" loading="lazy" />
                } @else {
                  <span class="fallback" aria-hidden="true">📷</span>
                }
                @if (vendor.reviewCount > 0) {
                  <span class="pill">
                    <span class="star" aria-hidden="true">★</span>
                    <strong>{{ vendor.rating }}</strong>
                    <span class="of">({{ vendor.reviewCount }})</span>
                  </span>
                }
              </span>
              <span class="vbody">
                <strong class="vname">{{ vendor.businessName }}</strong>
                <span class="vmeta">{{ meta(vendor.category).label }} · {{ vendor.city }}</span>
                @if (vendor.priceFrom) {
                  <span class="vprice">{{ inr(vendor.priceFrom) }} onwards</span>
                } @else {
                  <span class="vprice soft">Price on request</span>
                }
              </span>
            </a>
          }
        </div>
      </section>
    }

    <section class="paths">
      <article>
        <h3>Still looking</h3>
        <p>
          Search by community, mother tongue and horoscope. Contact details open
          only when both families have shown interest.
        </p>
        <a mat-stroked-button routerLink="/auth/register">Create a profile</a>
      </article>

      <article>
        <h3>Already engaged</h3>
        <p>
          Skip the matchmaking. Tell us the date and the city, and vendors who
          are actually free that day come back with prices.
        </p>
        <a mat-stroked-button routerLink="/enquire">Ask for quotes</a>
      </article>
    </section>

    <footer class="foot">
      <p>Matrimony EventHub · Hyderabad</p>
      <nav>
        <a routerLink="/vendors">Vendors</a>
        <a routerLink="/enquire">Get quotes</a>
        <a routerLink="/auth/login">Sign in</a>
        <a routerLink="/auth/register">Register</a>
      </nav>
    </footer>
  `,
  styles: `
    :host { display: block; background: var(--ground); --ink: var(--brand-deep); --pink: var(--brand); }
    section { max-width: 72rem; margin: 0 auto; }

    header h2 { margin: 0; font-size: clamp(1.4rem, 3vw, 1.9rem); color: var(--ink);
                letter-spacing: -0.015em; }
    header p { margin: 0.6rem auto 0; max-width: 46ch; line-height: 1.6;
               color: rgb(0 0 0 / 0.62); font-size: 0.95rem; }

    .services { padding: clamp(2.5rem, 6vw, 4rem) clamp(1rem, 4vw, 2rem); }
    .services header { text-align: center; margin-bottom: 1.8rem; }

    .grid { display: grid; gap: 0.85rem;
            grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); }

    /* A photograph with the label sitting on it, rather than a glyph above a
       caption. The scrim is what keeps the label readable over a photo nobody
       has vetted for contrast. */
    .tile { position: relative; display: block; overflow: hidden; border-radius: 12px;
            aspect-ratio: 3 / 2; text-decoration: none; color: #fff; background: var(--brand-deep);
            transition: transform 140ms ease, box-shadow 140ms ease; }
    .tile:hover, .tile:focus-visible { transform: translateY(-3px);
            box-shadow: 0 14px 28px rgb(var(--brand-rgb) / 0.26); }
    .shot { position: absolute; inset: 0; display: block; }
    .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile::after { content: ''; position: absolute; inset: 0;
                   background: linear-gradient(to top, rgb(var(--scrim-rgb) / 0.82) 0%,
                                                       rgb(var(--scrim-rgb) / 0.22) 50%,
                                                       transparent 75%); }
    .label { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1;
             display: flex; flex-direction: column; gap: 0.1rem; padding: 0.75rem 0.85rem; }
    .label strong { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
    .sub { font-size: 0.75rem; opacity: 0.86; }

    .fallback { position: absolute; inset: 0; display: grid; place-items: center;
                font-size: 2.4rem;
                background: linear-gradient(135deg, var(--brand-deep) 0%, var(--brand-deep) 100%); }

    .wide { display: block; width: fit-content; margin: 1.8rem auto 0;
            background: var(--pink) !important; color: #fff !important;
            font-weight: 700; }

    /* ------------------------------------------------------------ featured */

    .featured { padding: 0 clamp(1rem, 4vw, 2rem) clamp(2.5rem, 6vw, 3.5rem); }
    .featured header { text-align: center; margin-bottom: 1.5rem; }
    .row { display: grid; gap: 0.9rem;
           grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }

    .vcard { display: flex; flex-direction: column; text-decoration: none; color: inherit;
             background: #fff; border: 1px solid rgb(0 0 0 / 0.1); border-radius: 12px;
             overflow: hidden; transition: transform 120ms ease, box-shadow 120ms ease; }
    .vcard:hover, .vcard:focus-visible { transform: translateY(-2px);
             box-shadow: 0 12px 26px rgb(0 0 0 / 0.12); }
    .vshot { position: relative; display: block; aspect-ratio: 4 / 3;
             background: rgb(0 0 0 / 0.05); }
    .vshot img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pill { position: absolute; left: 0.45rem; bottom: 0.45rem; display: flex;
            align-items: baseline; gap: 0.22rem; font-size: 0.74rem;
            padding: 0.2rem 0.45rem; border-radius: 999px;
            background: rgb(255 255 255 / 0.95); color: var(--brand-deep);
            box-shadow: 0 2px 6px rgb(0 0 0 / 0.22); }
    .pill strong { font-weight: 700; font-variant-numeric: tabular-nums; }
    .pill .star { color: var(--gold); font-size: 0.8rem; }
    .pill .of { color: rgb(0 0 0 / 0.5); font-size: 0.68rem; }

    .vbody { display: flex; flex-direction: column; gap: 0.15rem;
             padding: 0.65rem 0.8rem 0.8rem; }
    .vname { font-size: 0.95rem; font-weight: 600; color: var(--brand-deep);
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vmeta { font-size: 0.76rem; color: rgb(0 0 0 / 0.5); }
    .vprice { margin-top: 0.25rem; font-size: 0.85rem; font-weight: 700; color: var(--brand-deep);
              font-variant-numeric: tabular-nums; }
    .vprice.soft { font-weight: 400; color: rgb(0 0 0 / 0.5); }

    /* --------------------------------------------------------------- paths */

    .paths { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem;
             padding: 0 clamp(1rem, 4vw, 2rem) clamp(3rem, 7vw, 4.5rem); }
    .paths article { background: #fff; border: 1px solid rgb(0 0 0 / 0.09);
                     border-radius: 14px; padding: 1.6rem 1.7rem; display: flex;
                     flex-direction: column; align-items: flex-start; gap: 0.6rem; }
    h3 { margin: 0; font-size: 1.15rem; color: var(--ink); }
    .paths p { margin: 0; line-height: 1.6; color: rgb(0 0 0 / 0.66); font-size: 0.92rem; }
    .paths a { margin-top: 0.5rem; }

    .foot { border-top: 1px solid rgb(0 0 0 / 0.09); display: flex; flex-wrap: wrap;
            gap: 1rem; justify-content: space-between; align-items: center;
            font-size: 0.85rem; color: rgb(0 0 0 / 0.55);
            padding: 1.5rem clamp(1rem, 4vw, 3rem); }
    .foot nav { display: flex; gap: 1.2rem; }
    .foot a { color: var(--ink); text-decoration: none; }
    .foot a:hover { text-decoration: underline; }

    @media (max-width: 880px) { .paths { grid-template-columns: 1fr; } }
    @media (max-width: 560px) {
      .grid { grid-template-columns: 1fr 1fr; gap: 0.6rem; }
      .label strong { font-size: 0.88rem; }
    }
  `,
})
export class HomePage {
  protected readonly services = SERVICES;
  protected readonly totalCategories = Object.keys(CATEGORY_META).length;

  /**
   * The same public endpoint the browse grid uses, unfiltered by city.
   *
   * The landing page shows the whole country: a visitor who has not told us
   * where they are should not be shown an empty grid because the default city
   * happens to be one we are thin in.
   */
  private readonly tiles = httpResource<CategoryTile[]>(
    () => '/api/v1/vendors/category-counts',
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

  /** The top-rated bookable vendors, whatever category they are in. */
  private readonly top = httpResource<VendorSearchResult[]>(
    () => '/api/v1/vendors/search?sort=rating&limit=4',
    {
      parse: (raw) => (raw as { data: VendorSearchResult[] }).data,
      defaultValue: [],
    },
  );

  /** Only vendors with a review: "highest rated" over no ratings is a lie. */
  protected readonly featured = computed(() =>
    this.top.value().filter((v) => v.reviewCount > 0),
  );

  protected coverFor(category: VendorCategory): string | null {
    return this.byCategory().get(category)?.coverUrl ?? null;
  }

  protected coverOf(vendor: VendorSearchResult): string | null {
    const photos = vendor.photos ?? [];
    return (photos.find((p) => p.isCover) ?? photos[0])?.url ?? null;
  }

  /** "12 vendors · from ₹45,000", or an honest blank while it loads. */
  protected supply(category: VendorCategory): string {
    const tile = this.byCategory().get(category);
    if (!tile || tile.count === 0) return this.tiles.isLoading() ? ' ' : 'Coming soon';

    const many = `${tile.count} ${tile.count === 1 ? 'vendor' : 'vendors'}`;
    return tile.priceFrom ? `${many} · from ${formatInr(tile.priceFrom as Paisa)}` : many;
  }

  protected inr(paisa: number): string {
    return formatInr(paisa as Paisa);
  }

  protected meta(category: VendorCategory) {
    return CATEGORY_META[category];
  }

  protected slug(category: VendorCategory): string {
    return categorySlug(category);
  }
}
