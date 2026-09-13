import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  categorySlug,
  estimateCost,
  formatInr,
  seatsEveryone,
  type Paisa,
  type VendorCategory,
  type VendorSearchResult,
} from '@eventhub/contracts';

/**
 * A vendor on the browse grid, as a link into their page.
 *
 * Deliberately not the enquiry card. That one exists inside a wizard where the
 * only thing to do with a vendor is tick it, so it carries a checkbox and an
 * expander. Here the vendor has a page of their own, and the whole tile is the
 * way in - the family is still deciding who is worth reading about, not
 * assembling a shortlist yet.
 *
 * The price is worked out for the guest count in the rail rather than shown as
 * "from ₹850". A per-plate figure means one thing at 200 guests and something
 * else at 600, and every family comparing five caterers was doing that
 * multiplication in their head five times.
 *
 * The anatomy follows the marketplace reference: the rating rides on the
 * photograph as a pill rather than sitting in a line of text underneath. On a
 * grid of twelve cards the rating is what the eye is actually scanning for, and
 * as body text it has to be found twelve times. The photo is also where a
 * family's attention already is.
 */
@Component({
  selector: 'eh-browse-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <a class="card" [routerLink]="['/vendors', slug(category()), vendor().id]">
      <div class="frame">
        @if (cover(); as photo) {
          <img [src]="photo.url" [alt]="vendor().businessName" loading="lazy" />
        } @else {
          <span class="noshot" aria-hidden="true">📷</span>
        }

        @if (vendor().reviewCount > 0) {
          <span
            class="rating"
            [attr.aria-label]="
              vendor().rating + ' out of 5, ' + vendor().reviewCount + ' reviews'
            "
          >
            <span class="star" aria-hidden="true">★</span>
            <strong>{{ vendor().rating }}</strong>
            <span class="of">({{ vendor().reviewCount }})</span>
          </span>
        } @else {
          <span class="rating new">New</span>
        }

        @if (vendor().photos && vendor().photos!.length > 1) {
          <span class="shots">{{ vendor().photos!.length }} photos</span>
        }
        @if (vendor().kycStatus === 'VERIFIED') {
          <span class="verified" title="Identity and bank details verified">✓ Verified</span>
        }
      </div>

      <div class="body">
        <h3>{{ vendor().businessName }}</h3>
        <p class="where">{{ vendor().city }}</p>

        <p class="price">
          @if (estimate().total !== null) {
            <strong>{{ inr(estimate().total!) }}</strong>
            <span class="soft">for {{ guestCount() }} guests</span>
          } @else if (vendor().priceFrom) {
            <strong>{{ inr(vendor().priceFrom!) }}</strong>
            <span class="soft">onwards</span>
          } @else {
            <span class="soft">Price on request</span>
          }
        </p>

        @if (capacity(); as seats) {
          <p class="seats" [class.bad]="seats.tooSmall">{{ seats.text }}</p>
        }

        @if (vendor().topReview; as review) {
          <p class="quote">“{{ review.excerpt }}”</p>
        }
      </div>
    </a>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .card { height: 100%; display: flex; flex-direction: column; text-decoration: none;
            color: inherit; border: 1px solid rgb(0 0 0 / 0.1); border-radius: 12px;
            background: #fff; overflow: hidden;
            transition: transform 120ms ease, box-shadow 120ms ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgb(0 0 0 / 0.12); }

    .frame { position: relative; background: rgb(0 0 0 / 0.05); }
    .frame img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
    .noshot { display: grid; place-items: center; aspect-ratio: 4 / 3; font-size: 1.6rem;
              opacity: 0.3; }
    .shots { position: absolute; right: 0.45rem; bottom: 0.45rem; font-size: 0.66rem;
             color: #fff; background: rgb(0 0 0 / 0.55); border-radius: 3px;
             padding: 0.1rem 0.35rem; }
    .verified { position: absolute; left: 0.45rem; top: 0.45rem; font-size: 0.66rem;
                font-weight: 700; color: #1b5e20; background: rgb(255 255 255 / 0.94);
                border-radius: 3px; padding: 0.1rem 0.35rem; }

    /* The rating pill sits on the photograph, bottom-left, which is where a
       grid of cards is scanned. Flex with a gap rather than spaces in the
       template: Angular strips whitespace-only text nodes, so "4.2(4)" is what
       would actually render. */
    .rating { position: absolute; left: 0.45rem; bottom: 0.45rem; display: flex;
              align-items: baseline; gap: 0.22rem; font-size: 0.74rem;
              padding: 0.2rem 0.45rem; border-radius: 999px;
              background: rgb(255 255 255 / 0.95); color: var(--brand-deep);
              box-shadow: 0 2px 6px rgb(0 0 0 / 0.22); }
    .rating strong { font-weight: 700; font-variant-numeric: tabular-nums; }
    .rating .star { color: var(--star); font-size: 0.8rem; }
    .rating .of { color: rgb(0 0 0 / 0.5); font-size: 0.68rem; }
    .rating.new { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.03em;
                  color: rgb(0 0 0 / 0.6); }

    .body { flex: 1; padding: 0.7rem 0.8rem 0.85rem; display: flex;
            flex-direction: column; gap: 0.15rem; }
    h3 { margin: 0; font-size: 0.97rem; font-weight: 600; line-height: 1.25;
         color: var(--brand-deep); overflow: hidden; text-overflow: ellipsis;
         white-space: nowrap; }
    .where { margin: 0; font-size: 0.77rem; color: rgb(0 0 0 / 0.5);
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .soft { color: rgb(0 0 0 / 0.5); }
    .price { margin: 0.35rem 0 0; font-size: 0.8rem; display: flex;
             align-items: baseline; gap: 0.3rem; flex-wrap: wrap; }
    .price strong { font-size: 1rem; color: var(--brand-deep); font-variant-numeric: tabular-nums; }
    .seats { margin: 0; font-size: 0.75rem; color: #1b5e20; }
    .seats.bad { color: #b3261e; }

    /* Two lines, so a long review cannot stagger the grid. */
    .quote { margin: 0.35rem 0 0; padding-left: 0.5rem; font-size: 0.76rem;
             line-height: 1.45; color: rgb(0 0 0 / 0.6);
             border-left: 2px solid rgb(var(--star-rgb) / 0.7);
             display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
             -webkit-box-orient: vertical; overflow: hidden; }
  `,
})
export class BrowseCard {
  readonly vendor = input.required<VendorSearchResult>();
  readonly guestCount = input.required<number>();
  readonly category = input.required<VendorCategory>();

  protected readonly cover = computed(() => {
    const photos = this.vendor().photos ?? [];
    return photos.find((p) => p.isCover) ?? photos[0] ?? null;
  });

  /** The cheapest package that can actually seat the wedding. */
  protected readonly estimate = computed(() => {
    const guests = this.guestCount();
    const priced = (this.vendor().services ?? [])
      .map((service) => ({
        ...estimateCost({
          pricingModel: service.pricingModel,
          basePrice: service.basePrice,
          minimumUnits: service.minimumUnits,
          guestCount: guests,
        }),
        seats: seatsEveryone(service.capacity, guests),
      }))
      .sort((a, b) => {
        if (a.seats === false && b.seats !== false) return 1;
        if (b.seats === false && a.seats !== false) return -1;
        return (a.total ?? Infinity) - (b.total ?? Infinity);
      });

    return priced[0] ?? { total: null, basis: '', seats: null };
  });

  protected readonly capacity = computed(() => {
    const largest = (this.vendor().services ?? [])
      .map((s) => s.capacity ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    if (!largest) return null;

    const guests = this.guestCount();
    return largest >= guests
      ? { text: `Seats up to ${largest}`, tooSmall: false }
      : { text: `Seats ${largest} — you have ${guests}`, tooSmall: true };
  });

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly slug = categorySlug;
}
