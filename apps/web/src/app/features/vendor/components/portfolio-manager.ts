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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTO_BYTES,
  MAX_VENDOR_PHOTOS,
  type VendorDto,
  type VendorPhoto,
} from '@eventhub/contracts';

import { VendorApi } from '../data/vendor-api';
import type { AppError } from '../../../core/models/app-error';

/**
 * The vendor's gallery.
 *
 * This is the single strongest thing a vendor can do for themselves: a couple
 * choosing between two halls they cannot visit is choosing between two sets of
 * photographs. The cover is called out explicitly because it is the one that
 * appears on a search card, and vendors otherwise assume the first upload is
 * permanent.
 *
 * Unlike a matrimony photo there is no moderation wait to explain - KYC already
 * vetted the business, so an upload is live at once.
 */
@Component({
  selector: 'eh-portfolio-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <section class="portfolio">
      <header>
        <h2>Portfolio</h2>
        <p class="sub">
          Couples pick with their eyes. The cover photo is the one shown on your
          search card — make it your best.
        </p>
      </header>

      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

      @if (error(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }

      <div class="grid">
        @for (photo of photos(); track photo.id) {
          <figure class="tile" [class.cover]="photo.isCover">
            <img [src]="photo.url" [alt]="photo.caption ?? 'Portfolio photo'" />

            @if (photo.isCover) {
              <figcaption><span class="chip">Cover</span></figcaption>
            }

            @if (photo.caption) {
              <p class="caption">{{ photo.caption }}</p>
            }

            <div class="actions">
              @if (!photo.isCover) {
                <button mat-button type="button" [disabled]="busy()"
                        (click)="makeCover(photo)">
                  Make cover
                </button>
              }
              <button mat-button type="button" class="danger" [disabled]="busy()"
                      (click)="remove(photo)">
                Remove
              </button>
            </div>
          </figure>
        }

        @if (canAddMore()) {
          <label class="tile add">
            <input type="file" [accept]="accept" [disabled]="busy()" (change)="onPick($event)" />
            <span class="plus" aria-hidden="true">+</span>
            <span class="addLabel">Add a photo</span>
            <span class="limits">JPEG, PNG or WebP · up to {{ maxMb }} MB</span>
          </label>
        }
      </div>

      <label class="captionField">
        <span>Caption for the next upload (optional)</span>
        <input
          type="text"
          maxlength="140"
          placeholder="The lawn at dusk"
          [value]="caption()"
          (input)="caption.set($any($event.target).value)"
        />
      </label>

      <p class="count">{{ photos().length }} of {{ maxPhotos }} used</p>
    </section>
  `,
  styles: `
    .portfolio { display: flex; flex-direction: column; gap: 0.75rem; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .sub { margin: 0.2rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.85rem; }
    .grid { display: grid; gap: 0.9rem;
            grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); }
    .tile { margin: 0; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            background: #fff; overflow: hidden; display: flex;
            flex-direction: column; gap: 0.3rem; padding-bottom: 0.35rem; }
    .tile.cover { border-color: #2f2d78; box-shadow: 0 0 0 1px #2f2d78 inset; }
    .tile img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block;
                background: rgb(0 0 0 / 0.05); }
    figcaption { padding: 0 0.5rem; }
    .chip { font-size: 0.68rem; padding: 0.12rem 0.45rem; border-radius: 999px;
            font-weight: 600; background: #e6e5f5; color: #2f2d78; }
    .caption { margin: 0; padding: 0 0.5rem; font-size: 0.78rem;
               color: rgb(0 0 0 / 0.65); }
    .actions { display: flex; flex-wrap: wrap; padding: 0 0.25rem; margin-top: auto; }
    .actions .danger { color: #b3261e; }
    .add { cursor: pointer; align-items: center; justify-content: center;
           text-align: center; padding: 1.2rem 0.75rem; gap: 0.25rem;
           border-style: dashed; aspect-ratio: 4 / 3; }
    .add input { position: absolute; width: 1px; height: 1px; opacity: 0;
                 pointer-events: none; }
    .plus { font-size: 1.8rem; line-height: 1; color: #2f2d78; }
    .addLabel { font-size: 0.9rem; font-weight: 600; }
    .limits { font-size: 0.7rem; color: rgb(0 0 0 / 0.5); }
    .captionField { display: flex; flex-direction: column; gap: 0.25rem;
                    font-size: 0.72rem; text-transform: uppercase;
                    letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    .captionField input { font: inherit; font-size: 0.9rem; padding: 0.45rem 0.55rem;
                          border-radius: 6px; border: 1px solid rgb(0 0 0 / 0.25);
                          text-transform: none; letter-spacing: normal;
                          color: rgb(0 0 0 / 0.87); max-width: 26rem; }
    .count { margin: 0; font-size: 0.8rem; color: rgb(0 0 0 / 0.55); }
    .err { color: #b3261e; font-size: 0.85rem; margin: 0; }
  `,
})
export class PortfolioManager {
  private readonly api = inject(VendorApi);

  readonly vendor = input<VendorDto | null>(null);
  readonly changed = output<VendorDto>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly caption = signal('');

  protected readonly maxPhotos = MAX_VENDOR_PHOTOS;
  protected readonly maxMb = Math.floor(MAX_PHOTO_BYTES / (1024 * 1024));
  protected readonly accept = ALLOWED_PHOTO_MIME_TYPES.join(',');

  protected readonly photos = computed<readonly VendorPhoto[]>(
    () => this.vendor()?.photos ?? [],
  );
  protected readonly canAddMore = computed(
    () => this.photos().length < MAX_VENDOR_PHOTOS,
  );

  /**
   * Checked here as well as on the server - not for security, which is the
   * server's job, but so an obviously wrong file fails at once rather than
   * after uploading five megabytes over a site's patchy connection.
   */
  protected async onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.error.set(null);
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type as never)) {
      this.error.set('Use a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      this.error.set(`That photo is over ${this.maxMb} MB. Try a smaller one.`);
      return;
    }

    const caption = this.caption();
    await this.run(() => this.api.addPortfolioPhoto(file, caption));
    this.caption.set('');
  }

  protected async makeCover(photo: VendorPhoto): Promise<void> {
    await this.run(() => this.api.setCoverPhoto(photo.id));
  }

  protected async remove(photo: VendorPhoto): Promise<void> {
    await this.run(() => this.api.removePortfolioPhoto(photo.id));
  }

  private async run(action: () => Promise<VendorDto>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.changed.emit(await action());
    } catch (e) {
      const err = e as AppError;
      this.error.set(err.fields?.['file'] ?? err.message);
    } finally {
      this.busy.set(false);
    }
  }
}
