import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  budgetFit,
  estimateCost,
  formatInr,
  seatsEveryone,
  type Paisa,
  type VendorSearchResult,
} from '@eventhub/contracts';

interface Row {
  vendor: VendorSearchResult;
  total: Paisa | null;
  basis: string;
  fit: string;
  capacity: number | null;
  seats: boolean | null;
  cheapest: boolean;
}

/**
 * The shortlist, side by side.
 *
 * Comparing vendors is the actual job, and it was being done in a notes app:
 * the cards sat in one column, so telling whether the cheaper caterer was
 * cheaper once the guest count was applied meant scrolling and remembering.
 *
 * One row per thing worth comparing, cheapest marked, and anything that cannot
 * seat the wedding called out - because a hall that does not fit is not a
 * cheaper option, it is not an option. Every figure is an estimate; the quote
 * is what binds, which is the whole point of sending the enquiry.
 */
@Component({
  selector: 'eh-compare-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <section class="panel">
      <header>
        <div>
          <h2>Side by side</h2>
          <p>{{ blurb() }}</p>
        </div>
        <button mat-button (click)="closed.emit()">Close</button>
      </header>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="rowLabel"></th>
              @for (row of rows(); track row.vendor.id) {
                <th>
                  <span class="name">{{ row.vendor.businessName }}</span>
                  @if (row.cheapest) { <span class="tag">Lowest estimate</span> }
                </th>
              }
            </tr>
          </thead>
          <tbody>
            <tr>
              <th class="rowLabel">Estimated cost</th>
              @for (row of rows(); track row.vendor.id) {
                <td [class]="'fit-' + row.fit">
                  @if (row.total !== null) {
                    <strong>{{ inr(row.total) }}</strong>
                  } @else {
                    <span class="muted">On request</span>
                  }
                  <span class="basis">{{ row.basis }}</span>
                </td>
              }
            </tr>
            <tr>
              <th class="rowLabel">Capacity</th>
              @for (row of rows(); track row.vendor.id) {
                <td>
                  @if (row.capacity) {
                    <span [class.bad]="row.seats === false">
                      {{ row.capacity }}@if (row.seats === false) { — too small }
                    </span>
                  } @else {
                    <span class="muted">n/a</span>
                  }
                </td>
              }
            </tr>
            <tr>
              <th class="rowLabel">Rating</th>
              @for (row of rows(); track row.vendor.id) {
                <td>
                  {{ row.vendor.rating || '—' }}
                  <span class="muted">({{ row.vendor.reviewCount }})</span>
                </td>
              }
            </tr>
            <tr>
              <th class="rowLabel">Weddings done</th>
              @for (row of rows(); track row.vendor.id) {
                <td>{{ row.vendor.completedBookings }}</td>
              }
            </tr>
            <tr>
              <th class="rowLabel">Typical reply</th>
              @for (row of rows(); track row.vendor.id) {
                <td>
                  @if (row.vendor.medianResponseMins !== null) {
                    {{ responseLabel(row.vendor.medianResponseMins!) }}
                  } @else {
                    <span class="muted">—</span>
                  }
                </td>
              }
            </tr>
            <tr>
              <th class="rowLabel">Verified</th>
              @for (row of rows(); track row.vendor.id) {
                <td>
                  @if (row.vendor.kycStatus === 'VERIFIED') {
                    <span class="yes">✓</span>
                  } @else {
                    <span class="muted">Pending</span>
                  }
                </td>
              }
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .panel { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; background: #fff;
             padding: 1rem 1.1rem 1.1rem; }
    header { display: flex; justify-content: space-between; gap: 1rem;
             align-items: flex-start; margin-bottom: 0.8rem; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; color: #2f2d78; }
    header p { margin: 0.25rem 0 0; font-size: 0.82rem; color: rgb(0 0 0 / 0.6); }

    /* The table is the one thing allowed to scroll sideways, not the page. */
    .scroll { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; min-width: 30rem; }
    th, td { text-align: left; padding: 0.55rem 0.7rem; vertical-align: top;
             border-bottom: 1px solid rgb(0 0 0 / 0.07); font-size: 0.88rem; }
    thead th { border-bottom: 2px solid rgb(0 0 0 / 0.12); }
    .rowLabel { width: 9rem; color: rgb(0 0 0 / 0.55); font-weight: 500;
                font-size: 0.8rem; white-space: nowrap; }
    .name { display: block; font-weight: 600; }
    .tag { display: inline-block; margin-top: 0.2rem; font-size: 0.68rem; font-weight: 700;
           background: #c8e6c9; color: #1b5e20; padding: 0.1rem 0.4rem; border-radius: 999px; }
    td strong { display: block; font-variant-numeric: tabular-nums; font-size: 1rem; }
    .basis { display: block; font-size: 0.72rem; color: rgb(0 0 0 / 0.5); margin-top: 0.15rem; }
    .muted { color: rgb(0 0 0 / 0.45); }
    .bad { color: #b3261e; font-weight: 600; }
    .yes { color: #1b5e20; font-weight: 700; }
    .fit-WITHIN { background: #f1f8f2; }
    .fit-TIGHT { background: #fffaf0; }
    .fit-OVER { background: #fdf2f1; }
  `,
})
export class ComparePanel {
  readonly vendors = input.required<readonly VendorSearchResult[]>();
  readonly guestCount = input.required<number>();
  readonly budget = input<Paisa | null>(null);

  readonly closed = output<void>();

  /**
   * Built here rather than in the template: an @if inside a sentence leaks its
   * indentation as a text node, and the page read 'guests , against'.
   */
  protected readonly blurb = computed(() => {
    const budget = this.budget();
    const against = budget ? `, against a budget of ${this.inr(budget)}` : '';
    return `Estimated for ${this.guestCount()} guests${against}. The quote they send back is the real number.`;
  });

  protected readonly rows = computed<Row[]>(() => {
    const guests = this.guestCount();
    const budget = this.budget();

    const priced = this.vendors().map((vendor) => {
      const workable = (vendor.services ?? [])
        .map((s) => ({
          ...estimateCost({
            pricingModel: s.pricingModel,
            basePrice: s.basePrice,
            minimumUnits: s.minimumUnits,
            guestCount: guests,
          }),
          capacity: s.capacity ?? null,
          seats: seatsEveryone(s.capacity, guests),
        }))
        .sort((a, b) => {
          if (a.seats === false && b.seats !== false) return 1;
          if (b.seats === false && a.seats !== false) return -1;
          return (a.total ?? Infinity) - (b.total ?? Infinity);
        });

      const best = workable[0];
      const largest = (vendor.services ?? [])
        .map((s) => s.capacity ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);

      return {
        vendor,
        total: best?.total ?? vendor.priceFrom ?? null,
        basis: best?.basis ?? 'No packages listed',
        fit: budgetFit(best?.total ?? null, budget),
        capacity: largest || null,
        seats: largest ? largest >= guests : null,
        cheapest: false,
      };
    });

    // Only a workable option can be the lowest: a hall that cannot seat the
    // wedding being marked "cheapest" would be actively misleading.
    const contenders = priced.filter((r) => r.total !== null && r.seats !== false);
    const lowest = Math.min(...contenders.map((r) => r.total as number));
    for (const row of priced) {
      row.cheapest = row.seats !== false && row.total === lowest && contenders.length > 1;
    }
    return priced;
  });

  protected readonly inr = (paisa: number): string => formatInr(paisa as Paisa);
  protected readonly responseLabel = (mins: number): string =>
    mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
}
