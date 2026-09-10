import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import {
  CATEGORY_META,
  categoryFromSlug,
  categorySlug,
  estimateCost,
  formatInr,
  seatsEveryone,
  type Paisa,
  type RatingSummary,
  type ReviewDto,
  type VendorCategory,
  type VendorDto,
  type VendorServiceDto,
} from '@eventhub/contracts';

interface ReviewPage {
  items: ReviewDto[];
  total: number;
  page: number;
}

const NO_SUMMARY: RatingSummary = {
  average: 0,
  count: 0,
  histogram: [0, 0, 0, 0, 0],
  averages: { quality: 0, professionalism: 0, value: 0, flexibility: 0 },
};

const unwrap = <T,>(raw: unknown): T => (raw as { data: T }).data;

/**
 * One vendor, in full.
 *
 * Until now this page did not exist. A family could see a vendor as a tile in
 * a search grid and then, if they liked the look of it, tick a box - which is
 * the one thing you cannot reasonably ask somebody to do about a business they
 * have read four lines about. Every wedding site has this page because it is
 * where the decision is actually made.
 *
 * The order is the order the questions get asked: what does their work look
 * like, what would it cost me, what did other couples say, and only then, how
 * do I contact them. Pricing sits above reviews because a vendor out of budget
 * is not made affordable by good reviews, and reading them first wastes the
 * reader's afternoon.
 */
@Component({
  selector: 'eh-vendor-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule],
  template: `
    <main class="wrap">
      @if (vendor.value(); as v) {
        <nav class="crumbs">
          <a routerLink="/vendors">All categories</a>
          <span aria-hidden="true">›</span>
          <a [routerLink]="['/vendors', slug(categoryEnum())]">{{ meta().plural }}</a>
          <span aria-hidden="true">›</span>
          <span>{{ v.businessName }}</span>
        </nav>

        <!-- The gallery leads, because it is what a venue is judged on. -->
        @if (photos().length) {
          <section class="gallery">
            <!--
              The caption is positioned against the image, not the section.
              Against the section it sat on top of the thumbnail strip, which
              is also inside it.
            -->
            <div class="shot">
              <img class="hero" [src]="shown().url" [alt]="v.businessName" />
              @if (shown().caption) {
                <span class="caption">{{ shown().caption }}</span>
              }
            </div>
            @if (photos().length > 1) {
              <div class="strip">
                @for (photo of photos(); track photo.id) {
                  <button
                    type="button"
                    class="thumb"
                    [class.on]="photo.id === shown().id"
                    [attr.aria-label]="photo.caption ?? 'Photo'"
                    (click)="picked.set(photo.id)"
                    (mouseenter)="picked.set(photo.id)"
                  >
                    <img [src]="photo.url" alt="" loading="lazy" />
                  </button>
                }
              </div>
            }
          </section>
        }

        <header class="head">
          <div class="title">
            <h1>{{ v.businessName }}</h1>
            <p class="sub">
              {{ meta().label }} · {{ v.city }}
              @if (v.kycStatus === 'VERIFIED') {
                <span class="verified">✓ Verified business</span>
              }
            </p>
            <p class="scoreline">
              @if (v.reviewCount > 0) {
                <span class="stars" aria-hidden="true">{{ starsFor(v.rating) }}</span>
                <strong>{{ v.rating }}</strong>
                <a class="jump" href="#reviews">{{ v.reviewCount }} reviews</a>
              } @else {
                <span class="soft">No reviews yet</span>
              }
              <span class="soft">· {{ v.completedBookings }} weddings booked here</span>
              @if (v.medianResponseMins !== null) {
                <span class="soft">· replies in about {{ replyIn(v.medianResponseMins!) }}</span>
              }
            </p>
          </div>

          <aside class="cta">
            <p class="from">
              @if (v.priceFrom) {
                <span class="soft">Packages from</span>
                <strong>{{ inr(v.priceFrom) }}</strong>
              } @else {
                <span class="soft">Price on request</span>
              }
            </p>
            <a mat-flat-button class="ask" routerLink="/enquire" [queryParams]="{ vendor: v.id }">
              Ask for a quote
            </a>
            <p class="ctanote">
              Free, and you can ask up to five vendors at once. No payment until
              you accept a quote.
            </p>
          </aside>
        </header>

        <section class="about">
          <h2>About</h2>
          <p>{{ v.description }}</p>
        </section>

        <section class="packages">
          <div class="pkghead">
            <h2>Packages</h2>
            <label class="guests">
              Priced for
              <input
                type="number"
                min="10"
                max="5000"
                step="50"
                [value]="guests()"
                (input)="setGuests($any($event.target).value)"
              />
              guests
            </label>
          </div>

          @if (services.isLoading()) {
            <p class="soft">Loading packages…</p>
          } @else {
            <ul class="pkgs">
              @for (p of priced(); track p.service.id) {
                <li [class.unfit]="p.seats === false">
                  <div class="pkgtop">
                    <strong>{{ p.service.title }}</strong>
                    <span class="pkgprice">
                      @if (p.total !== null) {
                        {{ inr(p.total) }}
                      } @else {
                        On request
                      }
                    </span>
                  </div>
                  <p class="pkgbasis">{{ p.basis }}</p>
                  @if (p.service.description) {
                    <p class="pkgdesc">{{ p.service.description }}</p>
                  }
                  @if (p.service.capacity) {
                    <p class="pkgbasis" [class.bad]="p.seats === false">
                      Seats {{ p.service.capacity }}@if (p.seats === false) {
                        <span class="bad"> — too small for {{ guests() }}</span>
                      }
                    </p>
                  }
                  @if (p.service.inclusions.length) {
                    <ul class="incl">
                      @for (item of p.service.inclusions; track item) {
                        <li>{{ item }}</li>
                      }
                    </ul>
                  }
                </li>
              } @empty {
                <li class="soft">
                  No packages listed yet — ask them for a quote and they will
                  send one.
                </li>
              }
            </ul>
          }
        </section>

        <section class="reviews" id="reviews">
          <h2>Reviews</h2>

          @if (summary().count === 0) {
            <p class="soft">
              No reviews yet. Only couples who booked and completed through the
              platform can write one, so they start appearing after the first
              wedding here.
            </p>
          } @else {
            <div class="rsummary">
              <div class="headline">
                <strong class="big">{{ summary().average.toFixed(1) }}</strong>
                <span class="stars" aria-hidden="true">{{ starsFor(summary().average) }}</span>
                <span class="soft">{{ summary().count }} reviews</span>
              </div>
              <ul class="histogram">
                @for (row of histogram(); track row.stars) {
                  <li>
                    <span>{{ row.stars }}★</span>
                    <span class="bar"><span class="fill" [style.width.%]="row.percent"></span></span>
                    <span class="n">{{ row.count }}</span>
                  </li>
                }
              </ul>
              <ul class="aspects">
                @for (a of aspects(); track a.label) {
                  <li><span>{{ a.label }}</span><strong>{{ a.score.toFixed(1) }}</strong></li>
                }
              </ul>
            </div>

            <ul class="rlist">
              @for (review of reviews(); track review.id) {
                <li>
                  <div class="rtop">
                    <span class="stars" aria-hidden="true">{{ starsFor(review.rating) }}</span>
                    <strong>{{ review.title }}</strong>
                  </div>
                  <p class="rby">
                    {{ review.authorName }} · {{ monthOf(review.eventDate) }}
                    <span class="verified">✓ verified booking</span>
                    @if (review.amountBand) {
                      <span class="band">{{ review.amountBand }}</span>
                    }
                  </p>
                  <p class="rbody">{{ review.body }}</p>
                  @if (review.vendorReply; as reply) {
                    <blockquote class="reply">
                      <span class="who">Response from {{ v.businessName }}</span>
                      {{ reply.body }}
                    </blockquote>
                  }
                </li>
              }
            </ul>
          }
        </section>
      } @else if (vendor.isLoading()) {
        <p class="soft">Loading…</p>
      } @else {
        <section class="missing">
          <h1>We could not find that vendor</h1>
          <p>It may have been removed, or the link may be wrong.</p>
          <a routerLink="/vendors">Browse all categories</a>
        </section>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 940px; margin: 0 auto; padding: 1rem 1rem 4rem; }
    .soft { color: rgb(0 0 0 / 0.5); }
    h2 { margin: 0 0 0.6rem; font-size: 1.05rem; color: #23214f; }

    .crumbs { display: flex; gap: 0.4rem; align-items: center; font-size: 0.78rem;
              color: rgb(0 0 0 / 0.45); margin-bottom: 0.8rem; flex-wrap: wrap; }
    .crumbs a { color: #2f2d78; text-decoration: none; }
    .crumbs a:hover { text-decoration: underline; }

    .gallery { border-radius: 14px; overflow: hidden;
               background: rgb(0 0 0 / 0.05); margin-bottom: 1.1rem; }
    .shot { position: relative; }
    .hero { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
    .caption { position: absolute; left: 0.7rem; bottom: 0.7rem; font-size: 0.75rem;
               color: #fff; background: rgb(0 0 0 / 0.55); border-radius: 4px;
               padding: 0.15rem 0.45rem; }
    .strip { display: flex; gap: 0.35rem; padding: 0.5rem; background: #fff; }
    .thumb { width: 4.5rem; height: 3.2rem; padding: 0; border: 2px solid transparent;
             border-radius: 5px; overflow: hidden; cursor: pointer; background: none; }
    .thumb.on { border-color: #2f2d78; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .head { display: flex; gap: 1.4rem; align-items: flex-start; flex-wrap: wrap;
            padding-bottom: 1rem; border-bottom: 1px solid rgb(0 0 0 / 0.08); }
    .title { flex: 1; min-width: 260px; }
    h1 { margin: 0; font-size: 1.75rem; color: #23214f; letter-spacing: -0.01em; }
    .sub { margin: 0.25rem 0 0; font-size: 0.87rem; color: rgb(0 0 0 / 0.6); }
    .verified { color: #1b5e20; font-weight: 600; font-size: 0.78rem;
                margin-left: 0.3rem; }
    .scoreline { margin: 0.5rem 0 0; font-size: 0.83rem; display: flex;
                 align-items: center; gap: 0.35rem; flex-wrap: wrap; }
    .stars { color: #e8a33d; letter-spacing: 0.04em; }
    .jump { color: #2f2d78; }

    .cta { width: 250px; padding: 0.9rem; border: 1px solid rgb(0 0 0 / 0.12);
           border-radius: 12px; background: #fff; display: flex;
           flex-direction: column; gap: 0.5rem; }
    .from { margin: 0; display: flex; flex-direction: column; }
    .from strong { font-size: 1.3rem; color: #23214f; font-variant-numeric: tabular-nums; }
    .ask { background: #2f2d78 !important; color: #fff !important; font-weight: 600; }
    .ctanote { margin: 0; font-size: 0.72rem; line-height: 1.45; color: rgb(0 0 0 / 0.5); }

    .about, .packages, .reviews { padding: 1.2rem 0;
                                  border-bottom: 1px solid rgb(0 0 0 / 0.08); }
    .about p { margin: 0; font-size: 0.9rem; line-height: 1.65; color: rgb(0 0 0 / 0.78); }

    .pkghead { display: flex; justify-content: space-between; align-items: baseline;
               gap: 1rem; flex-wrap: wrap; }
    .guests { font-size: 0.8rem; color: rgb(0 0 0 / 0.6); }
    .guests input { font: inherit; font-size: 0.85rem; width: 5rem; padding: 0.25rem 0.4rem;
                    border: 1px solid rgb(0 0 0 / 0.2); border-radius: 6px;
                    margin: 0 0.25rem; }

    .pkgs { list-style: none; margin: 0.7rem 0 0; padding: 0; display: grid;
            gap: 0.7rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .pkgs > li { border: 1px solid rgb(0 0 0 / 0.1); border-radius: 10px;
                 padding: 0.8rem 0.9rem; background: #fff; }
    .pkgs > li.unfit { opacity: 0.6; }
    .pkgtop { display: flex; justify-content: space-between; gap: 0.7rem;
              align-items: baseline; }
    .pkgtop strong { font-size: 0.93rem; color: #23214f; }
    .pkgprice { font-size: 1rem; font-weight: 700; color: #23214f;
                font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pkgbasis { margin: 0.2rem 0 0; font-size: 0.74rem; color: rgb(0 0 0 / 0.5); }
    .pkgbasis .bad, .pkgbasis.bad { color: #b3261e; }
    .pkgdesc { margin: 0.35rem 0 0; font-size: 0.83rem; line-height: 1.5;
               color: rgb(0 0 0 / 0.7); }
    .incl { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex;
            gap: 0.3rem; flex-wrap: wrap; }
    .incl li { font-size: 0.72rem; color: rgb(0 0 0 / 0.65);
               background: rgb(0 0 0 / 0.05); border-radius: 4px; padding: 0.1rem 0.4rem; }

    .rsummary { display: grid; grid-template-columns: auto 1fr 1fr; gap: 1.2rem;
                align-items: start; padding-bottom: 1rem; }
    .headline { display: flex; flex-direction: column; }
    .big { font-size: 2.4rem; line-height: 1; color: #23214f;
           font-variant-numeric: tabular-nums; }
    .histogram, .aspects { list-style: none; margin: 0; padding: 0; }
    .histogram li { display: grid; grid-template-columns: 1.8rem 1fr 1.6rem;
                    align-items: center; gap: 0.4rem; font-size: 0.73rem;
                    color: rgb(0 0 0 / 0.6); }
    .bar { height: 0.45rem; border-radius: 3px; background: rgb(0 0 0 / 0.08);
           overflow: hidden; }
    .fill { display: block; height: 100%; background: #e8a33d; }
    .histogram .n { text-align: right; font-variant-numeric: tabular-nums; }
    .aspects li { display: flex; justify-content: space-between; font-size: 0.78rem;
                  color: rgb(0 0 0 / 0.65); padding: 0.1rem 0; }
    .aspects strong { font-variant-numeric: tabular-nums; }

    .rlist { list-style: none; margin: 0; padding: 0; }
    .rlist li { padding: 0.9rem 0; border-top: 1px solid rgb(0 0 0 / 0.07); }
    .rtop { display: flex; gap: 0.45rem; align-items: baseline; flex-wrap: wrap; }
    .rtop strong { font-size: 0.93rem; }
    .rby { margin: 0.2rem 0 0; font-size: 0.74rem; color: rgb(0 0 0 / 0.5);
           display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
    .band { background: rgb(0 0 0 / 0.06); border-radius: 3px; padding: 0.05rem 0.35rem; }
    .rbody { margin: 0.4rem 0 0; font-size: 0.86rem; line-height: 1.6;
             color: rgb(0 0 0 / 0.8); }
    .reply { margin: 0.6rem 0 0; padding: 0.5rem 0.75rem; border-left: 3px solid #2f2d78;
             background: rgb(47 45 120 / 0.04); font-size: 0.83rem; line-height: 1.5; }
    .who { display: block; font-weight: 600; font-size: 0.72rem; color: #2f2d78; }

    .missing { text-align: center; padding: 3rem 1rem; }

    @media (max-width: 720px) {
      .cta { width: 100%; }
      .rsummary { grid-template-columns: 1fr; gap: 0.8rem; }
      h1 { font-size: 1.35rem; }
    }
  `,
})
export class VendorDetailPage {
  readonly id = input.required<string>();
  /** The :category route segment, via withComponentInputBinding(). */
  readonly category = input<string>('venue');

  protected readonly guests = signal(200);
  protected readonly picked = signal<string | null>(null);

  protected readonly categoryEnum = computed<VendorCategory>(
    () => categoryFromSlug(this.category()) ?? 'VENUE',
  );
  protected readonly meta = computed(() => CATEGORY_META[this.categoryEnum()]);

  protected readonly vendor = httpResource<VendorDto>(
    () => `/api/v1/vendors/${this.id()}`,
    { parse: unwrap<VendorDto> },
  );

  protected readonly services = httpResource<VendorServiceDto[]>(
    () => `/api/v1/vendors/${this.id()}/services`,
    { parse: unwrap<VendorServiceDto[]>, defaultValue: [] },
  );

  private readonly summaryRes = httpResource<RatingSummary>(
    () => `/api/v1/vendors/${this.id()}/reviews/summary`,
    { parse: unwrap<RatingSummary>, defaultValue: NO_SUMMARY },
  );

  private readonly reviewsRes = httpResource<ReviewPage>(
    () => `/api/v1/vendors/${this.id()}/reviews`,
    { parse: unwrap<ReviewPage>, defaultValue: { items: [], total: 0, page: 1 } },
  );

  protected readonly summary = computed(() => this.summaryRes.value());
  protected readonly reviews = computed(() => this.reviewsRes.value().items);

  protected readonly photos = computed(() => {
    const all = this.vendor.value()?.photos ?? [];
    // Cover first: it is the shot the vendor chose to be judged on.
    return [...all].sort((a, b) => Number(b.isCover) - Number(a.isCover));
  });

  protected readonly shown = computed(() => {
    const all = this.photos();
    return all.find((p) => p.id === this.picked()) ?? all[0];
  });

  protected readonly priced = computed(() => {
    const guests = this.guests();
    return this.services
      .value()
      .map((service) => ({
        service,
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
  });

  protected readonly histogram = computed(() => {
    const counts = this.summary().histogram;
    const tallest = Math.max(...counts, 1);
    return counts.map((count, i) => ({
      stars: 5 - i,
      count,
      percent: Math.round((count / tallest) * 100),
    }));
  });

  protected readonly aspects = computed(() => {
    const a = this.summary().averages;
    return [
      { label: 'Quality of work', score: a.quality },
      { label: 'Professionalism', score: a.professionalism },
      { label: 'Value for money', score: a.value },
      { label: 'Flexibility', score: a.flexibility },
    ];
  });

  protected setGuests(value: string): void {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) this.guests.set(Math.min(5000, Math.round(n)));
  }

  protected starsFor(rating: number): string {
    const filled = Math.round(rating);
    return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
  }

  protected monthOf(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  protected replyIn(mins: number): string {
    return mins < 60 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`;
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly slug = categorySlug;
}
