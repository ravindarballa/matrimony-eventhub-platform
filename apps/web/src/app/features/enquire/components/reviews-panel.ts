import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { httpResource } from '@angular/common/http';
import type { RatingSummary, ReviewDto } from '@eventhub/contracts';

import { GuestApi, unwrapGuest } from '../data/guest-api';

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

/**
 * What people who actually booked this vendor said afterwards.
 *
 * The histogram sits above the list rather than the average alone, because the
 * average is the one number that cannot distinguish the two vendors a family
 * most needs to tell apart: 4.2 with nothing below three, and 4.2 with a fifth
 * of the weddings at one star. Both print as four and a bit.
 *
 * Every review here is attached to a completed booking the platform processed
 * the money for, which is the one thing this app can offer that a review site
 * cannot. It is worth saying so on screen - "verified booking" is the whole
 * reason to read the rest.
 *
 * What a couple paid appears as a band and never as the figure. The ballpark is
 * the most useful thing a reader wants and nowhere else will tell them; the
 * exact number is a negotiated price and none of the internet's business.
 */
@Component({
  selector: 'eh-reviews-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <!--
      A button rather than a div: clicking the dark area to dismiss is a mouse
      habit, and anyone not using a mouse needs the same way out. Escape is
      bound on the host for the same reason.
    -->
    <button
      type="button"
      class="scrim"
      aria-label="Close reviews"
      (click)="closed.emit()"
    ></button>

    <section class="panel" role="dialog" aria-label="Reviews">
      <header>
        <div>
          <h2>{{ businessName() }}</h2>
          <p class="sub">Reviews from couples who booked through this platform</p>
        </div>
        <button mat-button type="button" class="x" (click)="closed.emit()">Close</button>
      </header>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (summary().count === 0 && !loading()) {
        <div class="none">
          <p><strong>No reviews yet.</strong></p>
          <p>
            This vendor has completed {{ completedBookings() }} weddings through the
            platform. A review can only be written against a booking that finished,
            so the first ones will appear as those couples get around to it.
          </p>
        </div>
      } @else {
        <div class="summary">
          <div class="headline">
            <strong class="big">{{ summary().average.toFixed(1) }}</strong>
            <span class="stars" aria-hidden="true">{{ starsFor(summary().average) }}</span>
            <span class="count">{{ summary().count }} reviews</span>
          </div>

          <ul class="histogram">
            @for (row of histogram(); track row.stars) {
              <li>
                <span class="lbl">{{ row.stars }}★</span>
                <span class="bar"><span class="fill" [style.width.%]="row.percent"></span></span>
                <span class="n">{{ row.count }}</span>
              </li>
            }
          </ul>

          <ul class="aspects">
            @for (a of aspects(); track a.label) {
              <li>
                <span class="lbl">{{ a.label }}</span>
                <strong>{{ a.score.toFixed(1) }}</strong>
              </li>
            }
          </ul>
        </div>

        <ul class="list">
          @for (review of reviews(); track review.id) {
            <li>
              <div class="head">
                <span class="stars small" aria-hidden="true">{{ starsFor(review.rating) }}</span>
                <strong class="title">{{ review.title }}</strong>
              </div>
              <p class="by">
                {{ review.authorName }} · {{ monthOf(review.eventDate) }}
                <span class="verified" title="Booked and paid through this platform">
                  ✓ verified booking
                </span>
                @if (review.amountBand) {
                  <span class="band">{{ review.amountBand }}</span>
                }
              </p>
              <p class="body">{{ review.body }}</p>

              @if (review.vendorReply) {
                <blockquote class="reply">
                  <span class="who">Response from {{ businessName() }}</span>
                  {{ review.vendorReply.body }}
                </blockquote>
              }
            </li>
          }
        </ul>

        @if (reviews().length < summary().count) {
          <p class="more">
            Showing {{ reviews().length }} of {{ summary().count }}. The rest are on the
            vendor's own page.
          </p>
        }
      }
    </section>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 60; display: block; }
    .scrim { position: absolute; inset: 0; background: rgb(0 0 0 / 0.45);
             border: 0; padding: 0; cursor: default; }
    .panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(560px, 100%);
             background: #fff; overflow-y: auto; box-shadow: -8px 0 32px rgb(0 0 0 / 0.2);
             display: flex; flex-direction: column; }

    header { position: sticky; top: 0; z-index: 1; background: #fff; display: flex;
             align-items: flex-start; justify-content: space-between; gap: 0.5rem;
             padding: 1rem 1.1rem 0.7rem; border-bottom: 1px solid rgb(0 0 0 / 0.1); }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .sub { margin: 0.15rem 0 0; font-size: 0.75rem; color: rgb(0 0 0 / 0.55); }
    .x { font-size: 0.8rem; }

    .none { padding: 1.2rem 1.1rem; font-size: 0.85rem; color: rgb(0 0 0 / 0.7);
            line-height: 1.55; }
    .none p { margin: 0 0 0.5rem; }

    .summary { padding: 0.9rem 1.1rem; border-bottom: 1px solid rgb(0 0 0 / 0.08); }
    .headline { display: flex; align-items: baseline; gap: 0.5rem; }
    .big { font-size: 2rem; font-variant-numeric: tabular-nums; line-height: 1; }
    .stars { color: var(--star); letter-spacing: 0.05em; }
    .stars.small { font-size: 0.85rem; }
    .count { font-size: 0.78rem; color: rgb(0 0 0 / 0.55); }

    .histogram { list-style: none; margin: 0.7rem 0 0; padding: 0; display: flex;
                 flex-direction: column; gap: 0.2rem; }
    .histogram li { display: grid; grid-template-columns: 2rem 1fr 2rem;
                    align-items: center; gap: 0.5rem; font-size: 0.74rem;
                    color: rgb(0 0 0 / 0.6); }
    .bar { height: 0.5rem; border-radius: 3px; background: rgb(0 0 0 / 0.08);
           overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--star); }
    .histogram .n { text-align: right; font-variant-numeric: tabular-nums; }

    .aspects { list-style: none; margin: 0.8rem 0 0; padding: 0.6rem 0 0;
               border-top: 1px solid rgb(0 0 0 / 0.08); display: grid;
               grid-template-columns: repeat(2, 1fr); gap: 0.35rem 1rem; }
    .aspects li { display: flex; justify-content: space-between; font-size: 0.78rem;
                  color: rgb(0 0 0 / 0.65); }
    .aspects strong { font-variant-numeric: tabular-nums; color: rgb(0 0 0 / 0.85); }

    .list { list-style: none; margin: 0; padding: 0; }
    .list li { padding: 0.9rem 1.1rem; border-bottom: 1px solid rgb(0 0 0 / 0.07); }
    .head { display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap; }
    .title { font-size: 0.92rem; }
    .by { margin: 0.25rem 0 0; font-size: 0.73rem; color: rgb(0 0 0 / 0.5);
          display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
    .verified { color: #1b5e20; font-weight: 600; }
    .band { background: rgb(0 0 0 / 0.06); border-radius: 3px; padding: 0.05rem 0.35rem; }
    .body { margin: 0.4rem 0 0; font-size: 0.85rem; line-height: 1.55;
            color: rgb(0 0 0 / 0.8); }

    .reply { margin: 0.6rem 0 0; padding: 0.5rem 0.7rem; border-left: 3px solid var(--brand);
             background: rgb(var(--brand-rgb) / 0.04); font-size: 0.81rem; line-height: 1.5;
             color: rgb(0 0 0 / 0.75); }
    .who { display: block; font-weight: 600; font-size: 0.72rem; color: var(--brand);
           margin-bottom: 0.15rem; }

    .more { margin: 0; padding: 0.8rem 1.1rem; font-size: 0.78rem;
            color: rgb(0 0 0 / 0.55); }

    @media (max-width: 600px) {
      .panel { width: 100%; }
      .aspects { grid-template-columns: 1fr; }
    }
  `,
})
export class ReviewsPanel {
  private readonly api = inject(GuestApi);

  readonly vendorId = input.required<string>();
  readonly businessName = input.required<string>();
  readonly completedBookings = input(0);

  readonly closed = output<void>();

  private readonly summaryRes = httpResource<RatingSummary>(
    () => this.api.reviewSummaryUrl(this.vendorId()),
    { parse: unwrapGuest<RatingSummary>, defaultValue: NO_SUMMARY },
  );

  private readonly listRes = httpResource<ReviewPage>(
    () => this.api.reviewsUrl(this.vendorId()),
    {
      parse: unwrapGuest<ReviewPage>,
      defaultValue: { items: [], total: 0, page: 1 },
    },
  );

  protected readonly loading = computed(
    () => this.summaryRes.isLoading() || this.listRes.isLoading(),
  );
  protected readonly summary = computed(() => this.summaryRes.value());
  protected readonly reviews = computed(() => this.listRes.value().items);

  /**
   * Bars are drawn against the tallest bar, not against the total. Against the
   * total, a vendor whose reviews are all five stars gets one full bar and four
   * invisible ones, which is technically honest and reads as a rendering fault.
   */
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

  protected starsFor(rating: number): string {
    const filled = Math.round(rating);
    return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
  }

  /** The month of the wedding, because the year alone dates a review badly. */
  protected monthOf(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', {
      month: 'short',
      year: 'numeric',
    });
  }
}
