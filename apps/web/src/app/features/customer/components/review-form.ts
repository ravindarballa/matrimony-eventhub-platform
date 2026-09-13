import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAX_REVIEW_BODY,
  MAX_REVIEW_TITLE,
  MIN_REVIEW_BODY,
  overallRating,
  type ReviewDto,
  type ReviewScores,
} from '@eventhub/contracts';

import { CustomerApi } from '../data/customer-api';

/** The four aspects, in the order they are asked. */
const ASPECTS: { key: keyof ReviewScores; label: string; hint: string }[] = [
  {
    key: 'quality',
    label: 'Quality of work',
    hint: 'Did what arrived match what was promised and photographed?',
  },
  {
    key: 'professionalism',
    label: 'Professionalism',
    hint: 'Answering messages, turning up when they said they would.',
  },
  {
    key: 'value',
    label: 'Value for money',
    hint: 'What it cost against what it was worth. Not the same as cheap.',
  },
  {
    key: 'flexibility',
    label: 'Flexibility',
    hint: 'When something changed, did they make the day easier or harder?',
  },
];

/**
 * Writing a review of a vendor you actually booked.
 *
 * Four scores rather than one, because "4 stars" tells the next couple almost
 * nothing: a caterer who cooked beautifully and never answered the phone and
 * one who was reachable at midnight but served cold food both average out to
 * the same number, and they are not the same problem.
 *
 * The body has a floor of thirty characters. A rating with no reason attached
 * is a number the next family cannot weigh, and asking for a sentence is a
 * smaller imposition than publishing an unexplained one star against somebody's
 * livelihood.
 *
 * It appears only once the booking is finished and disappears once written -
 * one booking, one review, which is what makes the rating on the search page
 * mean something.
 */
@Component({
  selector: 'eh-review-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <section class="panel">
      @if (written(); as review) {
        <h2>Your review</h2>
        <div class="done">
          <p class="head">
            <span class="stars" aria-hidden="true">{{ starsFor(review.rating) }}</span>
            <strong>{{ review.title }}</strong>
          </p>
          <p class="body">{{ review.body }}</p>
          <p class="note">
            Published as <strong>{{ review.authorName }}</strong>
            {{ bandNote(review) }}
          </p>
          @if (review.vendorReply) {
            <blockquote class="reply">
              <span class="who">The vendor replied</span>
              {{ review.vendorReply.body }}
            </blockquote>
          }
        </div>
      } @else {
        <h2>How did it go?</h2>
        <p class="lede">
          Only couples who booked and completed can review, which is why these
          ratings are worth reading. Yours will be published under your first
          name and last initial.
        </p>

        <ul class="aspects">
          @for (aspect of aspects; track aspect.key) {
            <li>
              <div class="labels">
                <strong>{{ aspect.label }}</strong>
                <span class="hint">{{ aspect.hint }}</span>
              </div>
              <div class="stars-input" role="radiogroup" [attr.aria-label]="aspect.label">
                @for (star of [1, 2, 3, 4, 5]; track star) {
                  <button
                    type="button"
                    class="star"
                    role="radio"
                    [class.on]="scores()[aspect.key] >= star"
                    [attr.aria-checked]="scores()[aspect.key] === star"
                    [attr.aria-label]="star + ' out of 5'"
                    (click)="setScore(aspect.key, star)"
                  >
                    ★
                  </button>
                }
              </div>
            </li>
          }
        </ul>

        <p class="overall">
          Overall
          <strong>{{ allScored() ? overall().toFixed(1) : '—' }}</strong>
          <span class="hint">the mean of the four, which is what gets published</span>
        </p>

        <label class="field">
          <span>Headline</span>
          <input
            type="text"
            [attr.maxlength]="maxTitle"
            placeholder="In one line, what should the next couple know?"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
          />
        </label>

        <label class="field">
          <span>What happened</span>
          <textarea
            rows="5"
            [attr.maxlength]="maxBody"
            placeholder="What went well, what did not, and what you would tell a friend."
            [value]="body()"
            (input)="body.set($any($event.target).value)"
          ></textarea>
          <span class="counter" [class.short]="body().length < minBody">
            {{ body().length }} / {{ minBody }} characters minimum
          </span>
        </label>

        @if (error(); as e) {
          <p class="err" role="alert">{{ e }}</p>
        }

        <div class="actions">
          <button
            mat-flat-button
            class="submit"
            [disabled]="!ready() || busy()"
            (click)="submit()"
          >
            {{ busy() ? 'Publishing…' : 'Publish review' }}
          </button>
          <span class="warn">Once published it cannot be edited, and the vendor cannot remove it.</span>
        </div>
      }
    </section>
  `,
  styles: `
    .panel { border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px; background: #fff;
             padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.7rem; }
    h2 { margin: 0; font-size: 1rem; font-weight: 600; }
    .lede { margin: 0; font-size: 0.83rem; color: rgb(0 0 0 / 0.6); line-height: 1.5; }

    .aspects { list-style: none; margin: 0; padding: 0; display: flex;
               flex-direction: column; gap: 0.6rem; }
    .aspects li { display: flex; align-items: center; justify-content: space-between;
                  gap: 1rem; flex-wrap: wrap; }
    .labels { display: flex; flex-direction: column; }
    .labels strong { font-size: 0.87rem; }
    .hint { font-size: 0.73rem; color: rgb(0 0 0 / 0.5); }

    .stars-input { display: flex; gap: 0.1rem; }
    .star { font-size: 1.4rem; line-height: 1; background: none; border: 0; padding: 0 0.1rem;
            cursor: pointer; color: rgb(0 0 0 / 0.18); transition: color 80ms ease; }
    .star.on { color: var(--star); }
    .star:hover { color: #d18f20; }

    .overall { margin: 0; padding-top: 0.5rem; border-top: 1px solid rgb(0 0 0 / 0.08);
               display: flex; align-items: baseline; gap: 0.45rem; font-size: 0.85rem; }
    .overall strong { font-size: 1.1rem; font-variant-numeric: tabular-nums; }

    .field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem;
             color: rgb(0 0 0 / 0.7); }
    .field input, .field textarea { font: inherit; font-size: 0.87rem; padding: 0.5rem 0.6rem;
                                    border: 1px solid rgb(0 0 0 / 0.24); border-radius: 7px;
                                    background: #fff; resize: vertical; }
    .field input:focus, .field textarea:focus { outline: 2px solid var(--brand); outline-offset: -1px; }
    .counter { font-size: 0.72rem; color: rgb(0 0 0 / 0.45); }
    .counter.short { color: #8a5a00; }

    .actions { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
    .submit { background: var(--brand) !important; color: #fff !important; font-weight: 600; }
    .submit[disabled] { background: rgb(0 0 0 / 0.12) !important; color: rgb(0 0 0 / 0.38) !important; }
    .warn { font-size: 0.72rem; color: rgb(0 0 0 / 0.5); }
    .err { margin: 0; font-size: 0.82rem; color: #b3261e; }

    .done { display: flex; flex-direction: column; gap: 0.4rem; }
    .done .head { margin: 0; display: flex; align-items: baseline; gap: 0.45rem; }
    .stars { color: var(--star); }
    .done .body { margin: 0; font-size: 0.86rem; line-height: 1.55; color: rgb(0 0 0 / 0.8); }
    .note { margin: 0; font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    .reply { margin: 0.3rem 0 0; padding: 0.5rem 0.7rem; border-left: 3px solid var(--brand);
             background: rgb(var(--brand-rgb) / 0.04); font-size: 0.82rem; line-height: 1.5; }
    .who { display: block; font-weight: 600; font-size: 0.72rem; color: var(--brand); }
  `,
})
export class ReviewForm {
  private readonly api = inject(CustomerApi);

  readonly bookingId = input.required<string>();
  /** The review already on file, if the page found one. */
  readonly existing = input<ReviewDto | null>(null);

  readonly published = output<ReviewDto>();

  protected readonly aspects = ASPECTS;
  protected readonly minBody = MIN_REVIEW_BODY;
  protected readonly maxBody = MAX_REVIEW_BODY;
  protected readonly maxTitle = MAX_REVIEW_TITLE;

  protected readonly scores = signal<ReviewScores>({
    quality: 0,
    professionalism: 0,
    value: 0,
    flexibility: 0,
  });
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** What this component wrote in this session, or what the page handed it. */
  private readonly justWritten = signal<ReviewDto | null>(null);
  protected readonly written = computed(() => this.justWritten() ?? this.existing());

  protected readonly allScored = computed(() =>
    Object.values(this.scores()).every((n) => n >= 1),
  );
  protected readonly overall = computed(() => overallRating(this.scores()));
  protected readonly ready = computed(
    () =>
      this.allScored() &&
      this.title().trim().length >= 3 &&
      this.body().trim().length >= MIN_REVIEW_BODY,
  );

  protected setScore(key: keyof ReviewScores, value: number): void {
    this.scores.update((s) => ({ ...s, [key]: value }));
  }

  /**
   * Built here rather than in the template. An `@if` around the band leaks the
   * template's own indentation into the sentence, which prints as a space
   * before the comma - invisible in the markup and obvious on screen.
   */
  protected bandNote(review: ReviewDto): string {
    return review.amountBand
      ? `What you paid appears only as a band — ${review.amountBand} — and never as the figure.`
      : 'What you paid is never published as a figure.';
  }

  protected starsFor(rating: number): string {
    const filled = Math.round(rating);
    return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
  }

  protected async submit(): Promise<void> {
    if (!this.ready() || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const review = await this.api.createReview({
        bookingId: this.bookingId(),
        scores: this.scores(),
        title: this.title().trim(),
        body: this.body().trim(),
      });
      this.justWritten.set(review);
      this.published.emit(review);
    } catch (err) {
      // 409 is the one a person can act on: it means the review is already
      // there, usually from a second tab, so say that rather than "failed".
      const status = (err as { status?: number }).status;
      this.error.set(
        status === 409
          ? 'You have already reviewed this booking.'
          : 'That could not be published. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
