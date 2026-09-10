import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  budgetFit,
  estimateCost,
  formatInr,
  seatsEveryone,
  type BudgetFit,
  type Paisa,
  type VendorSearchResult,
  type VendorServiceDto,
} from '@eventhub/contracts';

/** One package, with what it would actually cost this wedding. */
interface PricedPackage {
  service: VendorServiceDto;
  total: Paisa | null;
  basis: string;
  fit: BudgetFit;
  seats: boolean | null;
}

/**
 * A vendor as a family needs to judge one.
 *
 * The old card showed a name, a price floor and a star rating, which answers
 * none of the questions being asked: what does their work look like, what will
 * this actually cost me, and will the hall hold my guests? All three are
 * already in the data - portfolio photos, per-package pricing, venue capacity -
 * and none of them were on screen.
 *
 * "From ₹1,200" is the worst of it. That means one thing at 200 guests and
 * something else entirely at 600, and every family comparing five vendors was
 * doing that multiplication in their head five times. The tile does it for them
 * and says how, because a number nobody can check is a number nobody trusts.
 *
 * A tile rather than a wide row, for the same reason the profile cards are:
 * choosing means comparing, and comparing means seeing four at once instead of
 * one and a half. Everything past the headline - the description, the packages,
 * the inclusions - is behind Details, so the tile stays the size of a glance.
 */
@Component({
  selector: 'eh-vendor-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <article class="card" [class.picked]="picked()">
      @if (gallery().length) {
        <div class="gallery">
          <img class="main" [src]="shown().url" [alt]="vendor().businessName" />
          @if (gallery().length > 1) {
            <div class="strip">
              @for (photo of gallery(); track photo.id) {
                <button
                  type="button"
                  class="thumb"
                  [class.on]="photo.id === shown().id"
                  [attr.aria-label]="photo.caption ?? 'Photo'"
                  (mouseenter)="preview.set(photo.id)"
                  (focus)="preview.set(photo.id)"
                  (click)="preview.set(photo.id)"
                >
                  <img [src]="photo.url" alt="" />
                </button>
              }
            </div>
          }
          @if (shown().caption) {
            <span class="caption">{{ shown().caption }}</span>
          }
        </div>
      }

      <div class="body">
        <h3>
          {{ vendor().businessName }}
          @if (vendor().kycStatus === 'VERIFIED') {
            <span class="verified" title="Identity and bank details verified">✓</span>
          }
        </h3>

        <p class="meta">
          <!--
            The rating opens the reviews rather than merely stating them. It is
            the number a family least takes on faith, and until now it was the
            one thing on the card with nothing behind it.
          -->
          <button
            type="button"
            class="rating"
            [attr.aria-label]="'Read the ' + vendor().reviewCount + ' reviews'"
            (click)="reviewsRequested.emit()"
          >
            <span class="stars" aria-hidden="true">★</span>
            <strong>{{ vendor().rating || '—' }}</strong>
            <span class="count">
              @if (vendor().reviewCount) {
                ({{ vendor().reviewCount }} reviews)
              } @else {
                (no reviews yet)
              }
            </span>
          </button>
          · {{ vendor().city }}
        </p>

        <!--
          The headline number. An estimate, and labelled as one everywhere it
          appears - the binding figure is the quote the vendor sends back.
        -->
        <div class="estimate" [class]="'fit-' + best().fit">
          @if (best().total !== null) {
            <span class="approx">about</span>
            <strong>{{ inr(best().total!) }}</strong>
            <span class="for">for {{ guestCount() }} guests</span>
          } @else {
            <strong class="soft">{{ inr(vendor().priceFrom ?? 0) }} onwards</strong>
          }
          @switch (best().fit) {
            @case ('WITHIN') { <span class="chip ok">Within budget</span> }
            @case ('TIGHT') { <span class="chip warn">Close to your budget</span> }
            @case ('OVER') { <span class="chip over">Over budget</span> }
          }
        </div>
        <p class="basis">{{ best().basis }}</p>

        @if (capacityNote(); as note) {
          <p class="capacity" [class.bad]="note.tooSmall">{{ note.text }}</p>
        }

        <div class="stats">
          <span>{{ vendor().completedBookings }} weddings</span>
          @if (vendor().medianResponseMins !== null) {
            <span>~{{ responseLabel(vendor().medianResponseMins!) }} reply</span>
          }
        </div>

        <!--
          A line from the most recent review, on the card itself. Behind a click
          it was read by almost nobody, and a star rating with no words attached
          is the thing families trust least on every site that shows one.
        -->
        @if (vendor().topReview; as review) {
          <button type="button" class="quote" (click)="reviewsRequested.emit()">
            <span class="qstars" aria-hidden="true">{{ starsFor(review.rating) }}</span>
            <span class="qtitle">{{ review.title }}</span>
            <span class="qbody">“{{ review.excerpt }}”</span>
            <span class="qwho">{{ review.authorName }} · read all reviews</span>
          </button>
        }

        @if (open()) {
          <p class="desc">{{ vendor().description }}</p>

          <ul class="packages">
            @for (p of packages(); track p.service.id) {
              <li [class.unfit]="p.fit === 'OVER' || p.seats === false">
                <div class="pkgHead">
                  <strong>{{ p.service.title }}</strong>
                  <span class="pkgPrice">
                    @if (p.total !== null) { {{ inr(p.total) }} } @else { — }
                  </span>
                </div>
                <p class="pkgBasis">{{ p.basis }}</p>
                @if (p.service.capacity) {
                  <p class="pkgBasis" [class.bad]="p.seats === false">
                    Seats {{ p.service.capacity }}@if (p.seats === false) {
                      — too small for {{ guestCount() }}
                    }
                  </p>
                }
                @if (p.service.inclusions.length) {
                  <p class="incl">{{ p.service.inclusions.join(' · ') }}</p>
                }
              </li>
            }
          </ul>
        }

        <div class="actions">
          <button mat-flat-button class="add" [disabled]="disabled()" (click)="toggled.emit()">
            {{ picked() ? 'Remove' : 'Add to enquiry' }}
          </button>
          <button mat-button type="button" class="more" (click)="open.set(!open())">
            {{ open() ? 'Less' : detailsLabel() }}
          </button>
        </div>
      </div>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .card { height: 100%; display: flex; flex-direction: column;
            border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; background: #fff;
            overflow: hidden; transition: transform 120ms ease, box-shadow 120ms ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgb(0 0 0 / 0.1); }
    .card.picked { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }

    /* 4:3 - a venue is a room, and a room photographs landscape. */
    .gallery { position: relative; background: rgb(0 0 0 / 0.05); }
    .main { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
    .strip { position: absolute; left: 0.4rem; bottom: 0.4rem; display: flex; gap: 0.25rem; }
    .thumb { width: 1.9rem; height: 1.5rem; padding: 0; border: 2px solid rgb(255 255 255 / 0.6);
             border-radius: 3px; overflow: hidden; cursor: pointer; background: none; }
    .thumb.on { border-color: #fff; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .caption { position: absolute; right: 0.4rem; bottom: 0.4rem; font-size: 0.65rem;
               color: #fff; background: rgb(0 0 0 / 0.55); padding: 0.1rem 0.35rem;
               border-radius: 3px; max-width: 60%; overflow: hidden;
               text-overflow: ellipsis; white-space: nowrap; }

    .body { flex: 1; padding: 0.7rem 0.8rem 0.8rem; display: flex;
            flex-direction: column; gap: 0.35rem; }
    h3 { margin: 0; font-size: 0.98rem; font-weight: 600; line-height: 1.25;
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .verified { color: #1b5e20; }
    .meta { margin: 0; font-size: 0.78rem; color: rgb(0 0 0 / 0.6); }
    .stars { color: #e8a33d; }
    .rating { font: inherit; color: inherit; background: none; border: 0; padding: 0;
              cursor: pointer; text-decoration: underline; text-decoration-color:
              rgb(0 0 0 / 0.25); text-underline-offset: 2px; }
    .rating:hover { text-decoration-color: rgb(0 0 0 / 0.6); }
    .rating strong { color: rgb(0 0 0 / 0.8); }
    .count { color: rgb(0 0 0 / 0.45); }

    .estimate { display: flex; align-items: baseline; gap: 0.3rem; flex-wrap: wrap;
                padding: 0.4rem 0.5rem; border-radius: 7px; background: rgb(0 0 0 / 0.035); }
    .estimate strong { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
    .estimate .soft { font-size: 0.92rem; font-weight: 600; }
    .approx, .for { font-size: 0.72rem; color: rgb(0 0 0 / 0.55); }
    .fit-WITHIN { background: #e8f5e9; }
    .fit-TIGHT { background: #fff6e0; }
    .fit-OVER { background: #fdeceb; }
    .chip { width: 100%; font-size: 0.68rem; font-weight: 700; }
    .chip.ok { color: #1b5e20; }
    .chip.warn { color: #8a5a00; }
    .chip.over { color: #b3261e; }
    .basis { margin: 0; font-size: 0.71rem; color: rgb(0 0 0 / 0.5); }
    .capacity { margin: 0; font-size: 0.76rem; color: #1b5e20; }
    .capacity.bad { color: #b3261e; font-weight: 600; }

    .stats { display: flex; gap: 0.7rem; flex-wrap: wrap; font-size: 0.73rem;
             color: rgb(0 0 0 / 0.55); }

    .quote { display: flex; flex-direction: column; gap: 0.1rem; width: 100%;
             text-align: left; font: inherit; cursor: pointer; padding: 0.45rem 0.55rem;
             border: 0; border-left: 3px solid #e8a33d; border-radius: 0 6px 6px 0;
             background: rgb(232 163 61 / 0.09); }
    .quote:hover { background: rgb(232 163 61 / 0.16); }
    .qstars { color: #e8a33d; font-size: 0.78rem; letter-spacing: 0.04em; }
    .qtitle { font-size: 0.79rem; font-weight: 600; color: rgb(0 0 0 / 0.8);
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Three lines: enough to be a sentence, not enough to be the whole card. */
    .qbody { font-size: 0.76rem; line-height: 1.45; color: rgb(0 0 0 / 0.65);
             display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3;
             -webkit-box-orient: vertical; overflow: hidden; }
    .qwho { font-size: 0.68rem; color: rgb(0 0 0 / 0.45); margin-top: 0.1rem; }
    .desc { margin: 0.2rem 0 0; font-size: 0.83rem; color: rgb(0 0 0 / 0.75); line-height: 1.5; }

    .packages { list-style: none; margin: 0.2rem 0 0; padding: 0; display: flex;
                flex-direction: column; gap: 0.5rem; }
    .packages li { border-top: 1px solid rgb(0 0 0 / 0.08); padding-top: 0.45rem; }
    .packages li.unfit { opacity: 0.55; }
    .pkgHead { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.86rem; }
    .pkgPrice { font-variant-numeric: tabular-nums; font-weight: 600; }
    .pkgBasis { margin: 0.1rem 0 0; font-size: 0.72rem; color: rgb(0 0 0 / 0.5); }
    .pkgBasis.bad { color: #b3261e; }
    .incl { margin: 0.2rem 0 0; font-size: 0.74rem; color: rgb(0 0 0 / 0.6); }

    .actions { display: flex; gap: 0.25rem; align-items: center;
               margin-top: auto; padding-top: 0.6rem; }
    .add { flex: 1; font-size: 0.8rem; background: #2f2d78 !important;
           color: #fff !important; font-weight: 600; }
    .add[disabled] { background: rgb(0 0 0 / 0.12) !important; color: rgb(0 0 0 / 0.38) !important; }
    .more { font-size: 0.76rem; min-width: 0; padding: 0 0.5rem; }
  `,
})
export class VendorCard {
  readonly vendor = input.required<VendorSearchResult>();
  readonly guestCount = input.required<number>();
  readonly budget = input<Paisa | null>(null);
  readonly picked = input(false);
  readonly disabled = input(false);

  readonly toggled = output<void>();
  readonly reviewsRequested = output<void>();

  protected readonly open = signal(false);
  protected readonly preview = signal<string | null>(null);

  protected readonly gallery = computed(() => this.vendor().photos ?? []);
  protected readonly shown = computed(() => {
    const photos = this.gallery();
    return photos.find((p) => p.id === this.preview()) ?? photos[0];
  });

  /** Every package, priced for this wedding, cheapest workable first. */
  protected readonly packages = computed<PricedPackage[]>(() => {
    const guests = this.guestCount();
    const budget = this.budget();
    return (this.vendor().services ?? [])
      .map((service) => {
        const { total, basis } = estimateCost({
          pricingModel: service.pricingModel,
          basePrice: service.basePrice,
          minimumUnits: service.minimumUnits,
          guestCount: guests,
        });
        return {
          service,
          total,
          basis,
          fit: budgetFit(total, budget),
          seats: seatsEveryone(service.capacity, guests),
        };
      })
      .sort((a, b) => {
        // A hall that cannot seat the wedding is not the cheapest option, it is
        // not an option, so it sinks regardless of price.
        if (a.seats === false && b.seats !== false) return 1;
        if (b.seats === false && a.seats !== false) return -1;
        return (a.total ?? Infinity) - (b.total ?? Infinity);
      });
  });

  /** The package the headline speaks for: the cheapest that actually works. */
  protected readonly best = computed<PricedPackage>(() => {
    const all = this.packages();
    const workable = all.filter((p) => p.seats !== false);
    return (
      workable[0] ??
      all[0] ?? {
        service: null as never,
        total: this.vendor().priceFrom ?? null,
        basis: 'No packages listed yet — ask them for a quote',
        fit: budgetFit(this.vendor().priceFrom ?? null, this.budget()),
        seats: null,
      }
    );
  });

  protected readonly capacityNote = computed(() => {
    const largest = (this.vendor().services ?? [])
      .map((s) => s.capacity ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    if (!largest) return null;

    const guests = this.guestCount();
    return largest >= guests
      ? { text: `Seats up to ${largest} — room for your ${guests}`, tooSmall: false }
      : { text: `Largest space seats ${largest}, and you have ${guests}`, tooSmall: true };
  });

  protected readonly detailsLabel = computed(() => {
    const n = this.packages().length;
    return n ? `${n} package${n === 1 ? '' : 's'}` : 'Details';
  });

  protected starsFor(rating: number): string {
    const filled = Math.round(rating);
    return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
  }

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  protected readonly responseLabel = (mins: number): string =>
    mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
}
