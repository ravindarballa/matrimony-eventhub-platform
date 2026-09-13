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
  MAX_PROFILE_PHOTOS,
  type MatrimonyProfileDto,
  type ProfilePhoto,
} from '@eventhub/contracts';

import { MatrimonyApi } from '../data/matrimony-api';
import type { AppError } from '../../../core/models/app-error';

/**
 * The photo half of the profile editor.
 *
 * Kept out of the edit form deliberately: photos save the instant they are
 * chosen, while the rest of the profile saves on submit. Mixing an immediate
 * upload into a form with a Save button teaches people that their photo is not
 * stored until they press it, which is exactly when they close the tab.
 *
 * The moderation state is shown rather than hidden. A member who uploads a
 * photo and sees nothing happen assumes it failed; saying "being reviewed"
 * costs one chip and saves a support message.
 */
@Component({
  selector: 'eh-photo-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <section class="photos">
      <header>
        <h2>Photos</h2>
        <p class="sub">
          Profiles with a photo get far more interest. Nobody but you sees a photo
          until a moderator has approved it — usually within a day.
        </p>
      </header>

      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }

      @if (error(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }

      <div class="grid">
        @for (photo of photos(); track photo.id) {
          <figure class="tile" [class.primary]="photo.isPrimary">
            <img [src]="photo.url" [alt]="'Your photo'" />

            <figcaption>
              @switch (photo.moderation) {
                @case ('APPROVED') {
                  <span class="chip ok">Approved</span>
                }
                @case ('PENDING') {
                  <span class="chip wait">Being reviewed</span>
                }
                @case ('REJECTED') {
                  <span class="chip no" [title]="photo.rejectionReason ?? ''">
                    Rejected
                  </span>
                }
              }
              @if (photo.isPrimary) {
                <span class="chip main">Main photo</span>
              }
            </figcaption>

            @if (photo.moderation === 'REJECTED' && photo.rejectionReason) {
              <p class="reason">{{ photo.rejectionReason }}</p>
            }

            <div class="actions">
              @if (!photo.isPrimary && photo.moderation === 'APPROVED') {
                <button mat-button type="button" [disabled]="busy()"
                        (click)="makePrimary(photo)">
                  Make main
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
            <input
              type="file"
              [accept]="accept"
              [disabled]="busy()"
              (change)="onPick($event)"
            />
            <span class="plus" aria-hidden="true">+</span>
            <span class="addLabel">Add a photo</span>
            <span class="limits">JPEG, PNG or WebP · up to {{ maxMb }} MB</span>
          </label>
        }
      </div>

      <p class="count">
        {{ photos().length }} of {{ maxPhotos }} used
      </p>
    </section>
  `,
  styles: `
    .photos { display: flex; flex-direction: column; gap: 0.75rem; }
    h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .sub { margin: 0.2rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.85rem; }
    .grid { display: grid; gap: 0.9rem;
            grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); }
    .tile { margin: 0; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            background: #fff; overflow: hidden; display: flex;
            flex-direction: column; gap: 0.35rem; padding-bottom: 0.35rem; }
    .tile.primary { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand) inset; }
    .tile img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block;
                background: rgb(0 0 0 / 0.05); }
    figcaption { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0 0.5rem; }
    .chip { font-size: 0.68rem; padding: 0.12rem 0.45rem; border-radius: 999px;
            font-weight: 600; letter-spacing: 0.02em; }
    .chip.ok { background: #e3f3e5; color: #1b5e20; }
    .chip.wait { background: #fbf1dc; color: #8a5a00; }
    .chip.no { background: #fbe4e2; color: #b3261e; }
    .chip.main { background: #e6e5f5; color: var(--brand); }
    .reason { margin: 0; padding: 0 0.5rem; font-size: 0.75rem; color: #b3261e; }
    .actions { display: flex; flex-wrap: wrap; padding: 0 0.25rem; margin-top: auto; }
    .actions .danger { color: #b3261e; }
    .add { cursor: pointer; align-items: center; justify-content: center;
           text-align: center; padding: 1rem 0.75rem; gap: 0.25rem;
           border-style: dashed; aspect-ratio: 1; }
    .add input { position: absolute; width: 1px; height: 1px;
                 opacity: 0; pointer-events: none; }
    .plus { font-size: 1.8rem; line-height: 1; color: var(--brand); }
    .addLabel { font-size: 0.9rem; font-weight: 600; }
    .limits { font-size: 0.7rem; color: rgb(0 0 0 / 0.5); }
    .count { margin: 0; font-size: 0.8rem; color: rgb(0 0 0 / 0.55); }
    .err { color: #b3261e; font-size: 0.85rem; margin: 0; }
  `,
})
export class PhotoManager {
  private readonly api = inject(MatrimonyApi);

  /** The profile's photos, owned by the parent so one save updates both. */
  readonly profile = input<MatrimonyProfileDto | null>(null);

  /** Emitted with the profile the server returned after every change. */
  readonly changed = output<MatrimonyProfileDto>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly maxPhotos = MAX_PROFILE_PHOTOS;
  protected readonly maxMb = Math.floor(MAX_PHOTO_BYTES / (1024 * 1024));
  protected readonly accept = ALLOWED_PHOTO_MIME_TYPES.join(',');

  protected readonly photos = computed<readonly ProfilePhoto[]>(
    () => this.profile()?.photos ?? [],
  );

  protected readonly canAddMore = computed(
    () => this.photos().length < MAX_PROFILE_PHOTOS,
  );

  /**
   * Checks the file here as well as on the server. Not for security - the
   * server is the authority - but so an obviously wrong file fails instantly
   * instead of after uploading five megabytes over a phone connection.
   */
  protected async onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately, so picking the same file twice still fires a change.
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

    await this.run(() => this.api.uploadPhoto(file));
  }

  protected async makePrimary(photo: ProfilePhoto): Promise<void> {
    await this.run(() => this.api.setPrimaryPhoto(photo.id));
  }

  protected async remove(photo: ProfilePhoto): Promise<void> {
    await this.run(() => this.api.removePhoto(photo.id));
  }

  /** One place for the busy flag and the error mapping every action shares. */
  private async run(
    action: () => Promise<MatrimonyProfileDto>,
  ): Promise<void> {
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
