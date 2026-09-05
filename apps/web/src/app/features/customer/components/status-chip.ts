import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { Tone } from '../data/booking-display';

/** One coloured label. Used for both booking and payment states. */
@Component({
  selector: 'eh-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip" [class]="tone()">{{ label() }}</span>`,
  styles: `
    .chip {
      display: inline-block; font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.03em; text-transform: uppercase;
      padding: 0.2rem 0.55rem; border-radius: 999px; white-space: nowrap;
      border: 1px solid transparent;
    }
    .neutral  { background: #eceff1; color: #37474f; border-color: #cfd8dc; }
    .progress { background: #e3f2fd; color: #0d47a1; border-color: #bbdefb; }
    .good     { background: #e6f4ea; color: #1b5e20; border-color: #c8e6c9; }
    .warn     { background: #fbf1dc; color: #8a5a00; border-color: #f2dcae; }
    .bad      { background: #fdecea; color: #b3261e; border-color: #f7ccc8; }
  `,
})
export class StatusChip {
  readonly label = input.required<string>();
  readonly tone = input<Tone>('neutral');
}
