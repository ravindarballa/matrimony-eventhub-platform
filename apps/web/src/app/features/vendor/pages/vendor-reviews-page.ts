import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  MAX_VENDOR_REPLY,
  type RatingSummary,
  type ReviewDto,
  type VendorDto,
} from '@eventhub/contracts';

import { VendorApi, unwrap } from '../data/vendor-api';

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
 * What couples said, and the vendor's one chance to answer.
 *
 * A vendor can reply to any review, once, and cannot delete any of them. That
 * asymmetry is the whole product: a rating a vendor can curate is worth nothing
 * to the family reading it, and a rating with no right of reply is unfair to
 * the vendor being read about. One public answer is the arrangement that serves
 * both.
 *
 * The unanswered ones sort to the top, because a reply is most use while the
 * review is still the first thing a visitor sees.
 */
@Component({
  selector: 'eh-vendor-reviews-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <h1>Reviews</h1>
        <p class="lede">
          Written by couples who booked and completed through the platform. You
          can answer each one once, in public. Nobody can remove a review — not
          you, and not us.
        </p>
      </header>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (!loading() && summary().count === 0) {
        <section class="panel empty">
          <h2>No reviews yet</h2>
          <p>
            A review can only be written against a booking that finished, so the
            first one arrives after your first completed wedding on the platform.
            Until then your listing shows no rating rather than a made-up one.
          </p>
        </section>
      } @else {
        <section class="panel summary">
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
                <span>{{ a.label }}</span>
                <strong [class.weak]="a.score > 0 && a.score < 4">
                  {{ a.score.toFixed(1) }}
                </strong>
              </li>
            }
          </ul>

          @if (weakest(); as w) {
            <p class="advice">
              Your lowest score is <strong>{{ w.label }}</strong> at {{ w.score.toFixed(1) }}.
              That is the one a couple comparing you with another vendor will notice.
            </p>
          }
        </section>

        @if (unanswered() > 0) {
          <p class="todo">
            {{ unanswered() }} of {{ reviews().length }} have no reply yet.
          </p>
        }

        <ul class="list">
          @for (review of sorted(); track review.id) {
            <li class="panel">
              <div class="rhead">
                <span class="stars" aria-hidden="true">{{ starsFor(review.rating) }}</span>
                <strong class="title">{{ review.title }}</strong>
                <span class="score">{{ review.rating.toFixed(1) }}</span>
              </div>
              <p class="by">
                {{ review.authorName }} · {{ monthOf(review.eventDate) }} ·
                {{ categoryLabel(review.category) }}
              </p>
              <p class="body">{{ review.body }}</p>

              <ul class="scores">
                <li>Quality {{ review.scores.quality }}</li>
                <li>Professionalism {{ review.scores.professionalism }}</li>
                <li>Value {{ review.scores.value }}</li>
                <li>Flexibility {{ review.scores.flexibility }}</li>
              </ul>

              @if (review.vendorReply; as reply) {
                <blockquote class="reply">
                  <span class="who">Your reply · {{ monthOf(reply.repliedAt) }}</span>
                  {{ reply.body }}
                </blockquote>
              } @else if (replyingTo() === review.id) {
                <div class="composer">
                  <textarea
                    rows="3"
                    [attr.maxlength]="maxReply"
                    placeholder="Answer the point they raised. This is public and permanent."
                    [value]="draft()"
                    (input)="draft.set($any($event.target).value)"
                  ></textarea>
                  @if (error(); as e) {
                    <p class="err" role="alert">{{ e }}</p>
                  }
                  <div class="actions">
                    <button
                      mat-flat-button
                      class="send"
                      [disabled]="draft().trim().length < 2 || busy()"
                      (click)="send(review.id)"
                    >
                      {{ busy() ? 'Posting…' : 'Post reply' }}
                    </button>
                    <button mat-button [disabled]="busy()" (click)="cancel()">Cancel</button>
                    <span class="warn">You get one reply per review.</span>
                  </div>
                </div>
              } @else {
                <button mat-button class="answer" (click)="startReply(review.id)">
                  Reply publicly
                </button>
              }
            </li>
          }
        </ul>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 780px; margin: 0 auto; padding: 1.2rem 1rem 3rem;
            display: flex; flex-direction: column; gap: 0.9rem; }
    .head h1 { margin: 0; font-size: 1.4rem; }
    .lede { margin: 0.3rem 0 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.6);
            line-height: 1.55; max-width: 60ch; }

    .panel { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; background: #fff;
             padding: 0.9rem 1rem; }
    .empty h2 { margin: 0 0 0.4rem; font-size: 1rem; }
    .empty p { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.65); line-height: 1.55; }

    .headline { display: flex; align-items: baseline; gap: 0.5rem; }
    .big { font-size: 2rem; font-variant-numeric: tabular-nums; line-height: 1; }
    .stars { color: #e8a33d; letter-spacing: 0.05em; }
    .count { font-size: 0.78rem; color: rgb(0 0 0 / 0.55); }

    .histogram { list-style: none; margin: 0.7rem 0 0; padding: 0; display: flex;
                 flex-direction: column; gap: 0.2rem; }
    .histogram li { display: grid; grid-template-columns: 2rem 1fr 2rem; align-items: center;
                    gap: 0.5rem; font-size: 0.74rem; color: rgb(0 0 0 / 0.6); }
    .bar { height: 0.5rem; border-radius: 3px; background: rgb(0 0 0 / 0.08); overflow: hidden; }
    .fill { display: block; height: 100%; background: #e8a33d; }
    .histogram .n { text-align: right; font-variant-numeric: tabular-nums; }

    .aspects { list-style: none; margin: 0.8rem 0 0; padding: 0.6rem 0 0;
               border-top: 1px solid rgb(0 0 0 / 0.08); display: grid;
               grid-template-columns: repeat(2, 1fr); gap: 0.35rem 1rem; }
    .aspects li { display: flex; justify-content: space-between; font-size: 0.79rem;
                  color: rgb(0 0 0 / 0.65); }
    .aspects strong { font-variant-numeric: tabular-nums; }
    .aspects strong.weak { color: #b3261e; }
    .advice { margin: 0.7rem 0 0; font-size: 0.79rem; color: rgb(0 0 0 / 0.65);
              line-height: 1.5; }

    .todo { margin: 0; font-size: 0.8rem; color: #8a5a00; font-weight: 600; }

    .list { list-style: none; margin: 0; padding: 0; display: flex;
            flex-direction: column; gap: 0.7rem; }
    .rhead { display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap; }
    .title { font-size: 0.95rem; flex: 1; }
    .score { font-size: 0.8rem; color: rgb(0 0 0 / 0.5); font-variant-numeric: tabular-nums; }
    .by { margin: 0.2rem 0 0; font-size: 0.74rem; color: rgb(0 0 0 / 0.5); }
    .body { margin: 0.45rem 0 0; font-size: 0.87rem; line-height: 1.55;
            color: rgb(0 0 0 / 0.8); }

    .scores { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex;
              gap: 0.4rem; flex-wrap: wrap; }
    .scores li { font-size: 0.71rem; color: rgb(0 0 0 / 0.6); background: rgb(0 0 0 / 0.05);
                 border-radius: 3px; padding: 0.1rem 0.4rem; }

    .reply { margin: 0.7rem 0 0; padding: 0.5rem 0.7rem; border-left: 3px solid #2f2d78;
             background: rgb(47 45 120 / 0.04); font-size: 0.83rem; line-height: 1.5;
             color: rgb(0 0 0 / 0.75); }
    .who { display: block; font-weight: 600; font-size: 0.72rem; color: #2f2d78;
           margin-bottom: 0.15rem; }

    .answer { margin-top: 0.5rem; font-size: 0.8rem; }
    .composer { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .composer textarea { font: inherit; font-size: 0.86rem; padding: 0.5rem 0.6rem;
                         border: 1px solid rgb(0 0 0 / 0.24); border-radius: 7px;
                         resize: vertical; }
    .composer textarea:focus { outline: 2px solid #2f2d78; outline-offset: -1px; }
    .actions { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
    .send { background: #2f2d78 !important; color: #fff !important; font-weight: 600; }
    .send[disabled] { background: rgb(0 0 0 / 0.12) !important; color: rgb(0 0 0 / 0.38) !important; }
    .warn { font-size: 0.72rem; color: rgb(0 0 0 / 0.5); }
    .err { margin: 0; font-size: 0.8rem; color: #b3261e; }

    @media (max-width: 600px) {
      .aspects { grid-template-columns: 1fr; }
    }
  `,
})
export class VendorReviewsPage {
  private readonly api = inject(VendorApi);

  protected readonly maxReply = MAX_VENDOR_REPLY;

  private readonly me = httpResource<VendorDto>(() => this.api.meUrl, {
    parse: unwrap<VendorDto>,
  });

  /**
   * Both keyed off the vendor id, so they stay undefined until it arrives.
   * Returning undefined from the url function is how httpResource is told there
   * is nothing to fetch yet, which is better than firing at `/undefined`.
   */
  private readonly summaryRes = httpResource<RatingSummary>(
    () => {
      const id = this.me.value()?.id;
      return id ? this.api.reviewSummaryUrl(id) : undefined;
    },
    { parse: unwrap<RatingSummary>, defaultValue: NO_SUMMARY },
  );

  private readonly listRes = httpResource<ReviewPage>(
    () => {
      const id = this.me.value()?.id;
      return id ? this.api.reviewsUrl(id) : undefined;
    },
    { parse: unwrap<ReviewPage>, defaultValue: { items: [], total: 0, page: 1 } },
  );

  protected readonly loading = computed(
    () => this.me.isLoading() || this.summaryRes.isLoading() || this.listRes.isLoading(),
  );
  protected readonly summary = computed(() => this.summaryRes.value());
  protected readonly reviews = computed(() => this.listRes.value().items);

  /** Unanswered first, then newest. A reply is most use while it is on top. */
  protected readonly sorted = computed(() =>
    [...this.reviews()].sort((a, b) => {
      const answered = Number(!!a.vendorReply) - Number(!!b.vendorReply);
      if (answered !== 0) return answered;
      return b.createdAt.localeCompare(a.createdAt);
    }),
  );

  protected readonly unanswered = computed(
    () => this.reviews().filter((r) => !r.vendorReply).length,
  );

  protected readonly aspects = computed(() => {
    const a = this.summary().averages;
    return [
      { label: 'Quality of work', score: a.quality },
      { label: 'Professionalism', score: a.professionalism },
      { label: 'Value for money', score: a.value },
      { label: 'Flexibility', score: a.flexibility },
    ];
  });

  /** The score to work on, named rather than left for the vendor to spot. */
  protected readonly weakest = computed(() => {
    if (this.summary().count === 0) return null;
    return this.aspects().reduce((low, a) => (a.score < low.score ? a : low));
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

  protected readonly replyingTo = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected startReply(reviewId: string): void {
    this.replyingTo.set(reviewId);
    this.draft.set('');
    this.error.set(null);
  }

  protected cancel(): void {
    this.replyingTo.set(null);
    this.draft.set('');
    this.error.set(null);
  }

  protected async send(reviewId: string): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.replyToReview(reviewId, this.draft().trim());
      this.cancel();
      this.listRes.reload();
    } catch (err) {
      const status = (err as { status?: number }).status;
      this.error.set(
        status === 409
          ? 'You have already replied to this review.'
          : 'That could not be posted. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected starsFor(rating: number): string {
    const filled = Math.round(rating);
    return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
  }

  protected monthOf(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  protected categoryLabel(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
