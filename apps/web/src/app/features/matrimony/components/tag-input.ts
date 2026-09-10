import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAX_TAG_LENGTH } from '@eventhub/contracts';

/**
 * A short list of free-text tags — hobbies, interests.
 *
 * The server stores these as an array, so this collects them as one. A
 * comma-separated text box would only move the splitting problem downstream,
 * and leaves nobody sure whether "reading, writing" is one hobby or two.
 *
 * Enter and comma both commit, because people type both. Backspace on an empty
 * box removes the last tag, which is what every tag field in existence does and
 * what fingers expect.
 */
@Component({
  selector: 'eh-tag-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <div class="field">
      <span class="label">{{ label() }}</span>

      <div class="box" [class.full]="isFull()">
        @for (tag of tags(); track tag) {
          <span class="tag">
            {{ tag }}
            <button type="button" [attr.aria-label]="'Remove ' + tag" (click)="remove(tag)">
              ×
            </button>
          </span>
        }

        @if (!isFull()) {
          <input
            type="text"
            [placeholder]="tags().length ? '' : placeholder()"
            [attr.maxlength]="maxLength"
            [value]="draft()"
            (input)="draft.set($any($event.target).value)"
            (keydown)="onKey($event)"
            (blur)="commit()"
          />
        }
      </div>

      <small>
        @if (isFull()) {
          {{ max() }} is the limit — remove one to add another.
        } @else {
          Press Enter or comma after each one. {{ remaining() }} left.
        }
      </small>
    </div>
  `,
  styles: `
    .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 1rem; }
    .label { font-size: 0.75rem; color: rgb(0 0 0 / 0.6); }
    .box { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;
           min-height: 3rem; padding: 0.5rem 0.6rem; border-radius: 6px;
           border: 1px solid rgb(0 0 0 / 0.38); background: #fff; }
    .box:focus-within { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }
    .box.full { background: rgb(0 0 0 / 0.03); }
    .tag { display: inline-flex; align-items: center; gap: 0.3rem;
           background: #e6e5f5; color: #2f2d78; border-radius: 999px;
           padding: 0.2rem 0.3rem 0.2rem 0.7rem; font-size: 0.85rem; }
    .tag button { border: 0; background: transparent; cursor: pointer;
                  color: inherit; font-size: 1rem; line-height: 1;
                  padding: 0 0.25rem; border-radius: 999px; }
    .tag button:hover { background: rgb(47 45 120 / 0.15); }
    input { flex: 1; min-width: 8rem; border: 0; outline: none; font: inherit;
            font-size: 0.95rem; background: transparent; }
    small { font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
  `,
})
export class TagInput {
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly tags = input.required<readonly string[]>();
  readonly max = input.required<number>();

  readonly tagsChange = output<string[]>();

  protected readonly draft = signal('');
  protected readonly maxLength = MAX_TAG_LENGTH;

  protected readonly isFull = computed(() => this.tags().length >= this.max());
  protected readonly remaining = computed(() => this.max() - this.tags().length);

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter would submit the surrounding form, and a comma would land in the
      // tag itself; both mean "that one is finished" here.
      event.preventDefault();
      this.commit();
      return;
    }
    if (event.key === 'Backspace' && this.draft() === '' && this.tags().length) {
      event.preventDefault();
      this.tagsChange.emit(this.tags().slice(0, -1));
    }
  }

  protected commit(): void {
    const value = this.draft().trim().slice(0, MAX_TAG_LENGTH);
    this.draft.set('');
    if (!value || this.isFull()) return;
    // Case-insensitive, so "Trekking" and "trekking" are not two hobbies.
    if (this.tags().some((t) => t.toLowerCase() === value.toLowerCase())) return;
    this.tagsChange.emit([...this.tags(), value]);
  }

  protected remove(tag: string): void {
    this.tagsChange.emit(this.tags().filter((t) => t !== tag));
  }
}
