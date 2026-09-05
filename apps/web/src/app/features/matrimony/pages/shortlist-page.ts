import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { ShortlistEntryDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { ProfileCard } from '../components/profile-card';
import type { AppError } from '../../../core/models/app-error';

/**
 * Saved profiles, with the private note attached to each.
 *
 * The note is the point of this screen: families shortlist a dozen profiles and
 * cannot keep them straight without one. It is visible only here, to the owner.
 */
@Component({
  selector: 'eh-shortlist-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileCard, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header>
        <h1>Shortlist</h1>
        <p class="sub">Your notes here are private — nobody else ever sees them.</p>
      </header>

      @if (entries.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      @for (entry of entries.value(); track entry.targetProfileId) {
        <div class="row">
          <eh-profile-card
            [profile]="entry.profile"
            (interested)="sendInterest($event)"
            (shortlisted)="remove(entry.targetProfileId)"
          />

          <div class="note">
            <label>
              <span>Private note</span>
              <textarea
                rows="2"
                maxlength="500"
                [value]="entry.note ?? ''"
                (change)="saveNote(entry.targetProfileId, $any($event.target).value)"
                placeholder="Why this one stood out"
              ></textarea>
            </label>
          </div>
        </div>
      } @empty {
        @if (!entries.isLoading()) {
          <section class="empty">
            <h2>Nothing saved yet</h2>
            <p>Save profiles while you browse and compare them here later.</p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 46rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1.25rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .row { display: flex; flex-direction: column; gap: 0.5rem; }
    .note label { display: flex; flex-direction: column; gap: 0.25rem;
                  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
                  color: rgb(0 0 0 / 0.55); }
    .note textarea { font: inherit; font-size: 0.88rem; padding: 0.5rem;
                     border: 1px solid rgb(0 0 0 / 0.2); border-radius: 6px;
                     resize: vertical; text-transform: none; letter-spacing: normal;
                     color: rgb(0 0 0 / 0.87); }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
  `,
})
export class ShortlistPage {
  private readonly api = inject(MatrimonyApi);

  protected readonly entries = httpResource<ShortlistEntryDto[]>(
    () => this.api.shortlistUrl,
    { parse: unwrap<ShortlistEntryDto[]>, defaultValue: [] },
  );

  protected readonly message = signal<string | null>(null);

  /** Saving the same profile again updates the note rather than duplicating it. */
  protected async saveNote(targetProfileId: string, note: string): Promise<void> {
    try {
      await this.api.shortlist(targetProfileId, note);
      this.message.set('Note saved.');
    } catch (e) {
      this.message.set((e as AppError).message);
    }
  }

  protected async remove(targetProfileId: string): Promise<void> {
    try {
      await this.api.removeShortlist(targetProfileId);
      this.entries.reload();
    } catch (e) {
      this.message.set((e as AppError).message);
    }
  }

  protected async sendInterest(profileId: string): Promise<void> {
    try {
      await this.api.sendInterest(profileId);
      this.entries.reload();
      this.message.set('Interest sent.');
    } catch (e) {
      const err = e as AppError;
      this.message.set(
        err.code === 'MAT_QUOTA_EXCEEDED'
          ? 'You have used all your interests for today.'
          : err.message,
      );
    }
  }
}
