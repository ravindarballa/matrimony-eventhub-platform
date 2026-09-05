import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import type { PhotoModerationItemDto } from '@eventhub/contracts';

import type { AppError } from '../../../core/models/app-error';

interface Envelope<T> {
  data: T;
}

const REJECTION_REASONS = [
  'Not a photograph of the member',
  'Group photo — the member is not identifiable',
  'Contact details visible in the image',
  'Poor quality or heavily filtered',
  'Inappropriate content',
];

/**
 * Photo moderation.
 *
 * Nothing a member uploads is visible to anyone else until it passes through
 * here, so this queue is a gate rather than a cleanup pass. Rejections pick
 * from a fixed list of reasons: a moderator working through a hundred photos
 * writes worse prose than the list does, and the member gets a consistent
 * answer either way.
 */
@Component({
  selector: 'eh-moderation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header>
        <h1>Photo moderation</h1>
        <p class="sub">
          Members cannot be seen by anyone until a photo here is approved.
        </p>
      </header>

      @if (queue.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      <section class="grid">
        @for (item of queue.value(); track item.photoId) {
          <article class="card">
            <img [src]="item.url" [alt]="'Photo submitted by ' + item.displayName" />
            <div class="body">
              <strong>{{ item.displayName }}</strong>
              <span class="when">{{ submitted(item.submittedAt) }}</span>

              @if (rejecting() === item.photoId) {
                <label>
                  <span>Reason</span>
                  <select
                    [value]="reason()"
                    (change)="reason.set($any($event.target).value)"
                  >
                    @for (r of reasons; track r) {
                      <option [value]="r">{{ r }}</option>
                    }
                  </select>
                </label>
                <div class="actions">
                  <button mat-button [disabled]="busy()" (click)="rejecting.set(null)">
                    Cancel
                  </button>
                  <button
                    mat-flat-button
                    class="danger"
                    [disabled]="busy()"
                    (click)="decide(item, 'REJECTED')"
                  >
                    Reject
                  </button>
                </div>
              } @else {
                <div class="actions">
                  <button
                    mat-flat-button
                    [disabled]="busy()"
                    (click)="decide(item, 'APPROVED')"
                  >
                    Approve
                  </button>
                  <button mat-button [disabled]="busy()" (click)="startReject(item)">
                    Reject
                  </button>
                </div>
              }
            </div>
          </article>
        } @empty {
          @if (!queue.isLoading()) {
            <section class="empty">
              <h2>Queue is clear</h2>
              <p>No photos are waiting on a decision.</p>
            </section>
          }
        }
      </section>
    </main>
  `,
  styles: `
    .wrap { max-width: 56rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .grid { display: grid; gap: 1rem;
            grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
    .card { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            overflow: hidden; display: flex; flex-direction: column; }
    img { width: 100%; height: 14rem; object-fit: cover; background: #f3f1ea; display: block; }
    .body { padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .when { font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.7rem;
            text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    select { font: inherit; font-size: 0.85rem; padding: 0.4rem; border-radius: 6px;
             border: 1px solid rgb(0 0 0 / 0.25); text-transform: none;
             letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .actions { display: flex; gap: 0.4rem; margin-top: auto; }
    .danger { --mdc-filled-button-container-color: #b3261e; }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
    .empty { grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;
             color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
  `,
})
export class ModerationPage {
  private readonly http = inject(HttpClient);

  protected readonly reasons = REJECTION_REASONS;

  protected readonly queue = httpResource<PhotoModerationItemDto[]>(
    () => '/api/v1/admin/moderation/photos',
    {
      parse: (raw) => (raw as Envelope<PhotoModerationItemDto[]>).data,
      defaultValue: [],
    },
  );

  protected readonly rejecting = signal<string | null>(null);
  protected readonly reason = signal(REJECTION_REASONS[0]!);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  protected startReject(item: PhotoModerationItemDto): void {
    this.reason.set(REJECTION_REASONS[0]!);
    this.rejecting.set(item.photoId);
  }

  protected async decide(
    item: PhotoModerationItemDto,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await firstValueFrom(
        this.http.post('/api/v1/admin/moderation/photos', {
          profileId: item.profileId,
          photoId: item.photoId,
          decision,
          ...(decision === 'REJECTED' ? { reason: this.reason() } : {}),
        }),
      );
      this.rejecting.set(null);
      this.queue.reload();
      this.message.set(
        decision === 'APPROVED' ? 'Approved and now visible.' : 'Rejected, with a reason.',
      );
    } catch (e) {
      this.message.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected submitted(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
  }
}
