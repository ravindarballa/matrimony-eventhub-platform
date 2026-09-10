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
 * doing that multiplication in their head five times. The card does it for them
 * and says how, because a number nobody can check is a number nobody trusts.
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
        <header>
          <div>
            <h3>{{ vendor().businessName }}</h3>
            <p class="meta">
              {{ label(vendor().category) }} · {{ vendor().city }}
              @if (vendor().kycStatus === 'VERIFIED') {
                <span class="verified" title="Identity and bank details verified">✓ Verified</span>
              }
            </p>
          </div>

          <div class="rating" [title]="vendor().reviewCount + ' reviews'">
            <span class="stars" [attr.aria-label]="vendor().rating + ' out of 5'">
              {{ stars() }}
            </span>
            <span class="num">{{ vendor().rating || '—' }}</span>
            <span class="count">({{ vendor().reviewCount }})</span>
          </div>
        </header>

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
          <span>{{ vendor().completedBookings }} weddings done</span>
          @if (vendor().medianResponseMins !== null) {
            <span>replies in ~{{ responseLabel(vendor().medianResponseMins!) }}</span>
          }
          @if (packages().length) {
            <span>{{ packages().length }} package{{ packages().length === 1 ? '' : 's' }}</span>
          }
        </div>

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
          <button mat-button type="button" (click)="open.set(!open())">
            {{ open() ? 'Less' : 'Packages & details' }}
          </button>
        </div>
      </div>
    </article>
  `,
  styles: `
    .card { display: flex; flex-direction: column; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 12px; background: #fff; overflow: hidden; }
    .card.picked { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }

    .gallery { position: relative; background: rgb(0 0 0 / 0.05); }
    .main { width: 100%; aspect-ratio: 16 / 7; object-fit: cover; display: block; }
    .strip { position: absolute; left: 0.5rem; bottom: 0.5rem; display: flex; gap: 0.3rem; }
    .thumb { width: 2.6rem; height: 2rem; padding: 0; border: 2px solid transparent;
             border-radius: 4px; overflow: hidden; cursor: pointer; background: none; }
    .thumb.on { border-color: #fff; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .caption { position: absolute; right: 0.5rem; bottom: 0.5rem; font-size: 0.7rem;
               color: #fff; background: rgb(0 0 0 / 0.55); padding: 0.15rem 0.45rem;
               border-radius: 4px; }

    .body { padding: 0.9rem 1.1rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    header { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .meta { margin: 0.15rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    .verified { color: #1b5e20; font-weight: 700; margin-left: 0.35rem; }
    .rating { text-align: right; white-space: nowrap; }
    .stars { color: #e8a33d; letter-spacing: -1px; }
    .num { font-weight: 700; margin-left: 0.25rem; }
    .count { font-size: 0.78rem; color: rgb(0 0 0 / 0.5); }

    .estimate { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap;
                padding: 0.5rem 0.6rem; border-radius: 8px; background: rgb(0 0 0 / 0.035); }
    .estimate strong { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
    .estimate .soft { font-size: 1.05rem; font-weight: 600; }
    .approx, .for { font-size: 0.8rem; color: rgb(0 0 0 / 0.55); }
    .fit-WITHIN { background: #e8f5e9; }
    .fit-TIGHT { background: #fff6e0; }
    .fit-OVER { background: #fdeceb; }
    .chip { margin-left: auto; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.5rem;
            border-radius: 999px; }
    .chip.ok { background: #c8e6c9; color: #1b5e20; }
    .chip.warn { background: #ffe0a3; color: #8a5a00; }
    .chip.over { background: #f8c9c5; color: #b3261e; }
    .basis { margin: 0; font-size: 0.76rem; color: rgb(0 0 0 / 0.5); }
    .capacity { margin: 0; font-size: 0.82rem; color: #1b5e20; }
    .capacity.bad { color: #b3261e; font-weight: 600; }

    .stats { display: flex; gap: 0.9rem; flex-wrap: wrap; font-size: 0.78rem;
             color: rgb(0 0 0 / 0.55); }
    .desc { margin: 0.2rem 0 0; font-size: 0.87rem; color: rgb(0 0 0 / 0.75); line-height: 1.5; }

    .packages { list-style: none; margin: 0.2rem 0 0; padding: 0; display: flex;
                flex-direction: column; gap: 0.6rem; }
    .packages li { border-top: 1px solid rgb(0 0 0 / 0.08); padding-top: 0.55rem; }
    .packages li.unfit { opacity: 0.55; }
    .pkgHead { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.92rem; }
    .pkgPrice { font-variant-numeric: tabular-nums; font-weight: 600; }
    .pkgBasis { margin: 0.1rem 0 0; font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    .pkgBasis.bad { color: #b3261e; }
    .incl { margin: 0.25rem 0 0; font-size: 0.78rem; color: rgb(0 0 0 / 0.6); }

    .actions { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.3rem; }
    .add { background: #2f2d78 !important; color: #fff !important; font-weight: 600; }
    .add[disabled] { background: rgb(0 0 0 / 0.12) !important; color: rgb(0 0 0 / 0.38) !important; }
  `,
})
export class VendorCard {
  readonly vendor = input.required<VendorSearchResult>();
  readonly guestCount = input.required<number>();
  readonly budget = input<Paisa | null>(null);
  readonly picked = input(false);
  readonly disabled = input(false);

  readonly toggled = output<void>();

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

  protected readonly stars = computed(() => {
    const r = Math.round(this.vendor().rating ?? 0);
    return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r);
  });

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  protected readonly responseLabel = (mins: number): string =>
    mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
}
