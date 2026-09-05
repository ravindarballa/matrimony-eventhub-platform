import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { gunaVerdict } from '@eventhub/contracts';

/**
 * The 36-guna score, in colour bands.
 *
 * The bands follow the conventional reading (18 is the usual floor, 28 and above
 * is considered excellent) rather than an even split, because a family reading
 * this already knows what the numbers mean and a prettier scale would just be
 * wrong.
 */
@Component({
  selector: 'eh-guna-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [class]="tone()" [title]="title()">
      <strong>{{ score() }}</strong><span class="of">/36</span>
    </span>
  `,
  styles: `
    .badge { display: inline-flex; align-items: baseline; gap: 0.1rem;
             font-variant-numeric: tabular-nums; border-radius: 999px;
             padding: 0.15rem 0.5rem; border: 1px solid transparent;
             font-size: 0.8rem; white-space: nowrap; }
    .of { font-size: 0.68rem; opacity: 0.7; }
    .excellent { background: #e6f4ea; color: #1b5e20; border-color: #c8e6c9; }
    .good      { background: #e3f2fd; color: #0d47a1; border-color: #bbdefb; }
    .ok        { background: #fbf1dc; color: #8a5a00; border-color: #f2dcae; }
    .poor      { background: #fdecea; color: #b3261e; border-color: #f7ccc8; }
  `,
})
export class GunaBadge {
  readonly score = input.required<number>();

  protected readonly verdict = computed(() => gunaVerdict(this.score()));

  protected readonly tone = computed(
    () =>
      ({
        EXCELLENT: 'excellent',
        GOOD: 'good',
        ACCEPTABLE: 'ok',
        POOR: 'poor',
      })[this.verdict()],
  );

  protected readonly title = computed(
    () => `${this.score()} of 36 gunas — ${this.verdict().toLowerCase()} match`,
  );
}
