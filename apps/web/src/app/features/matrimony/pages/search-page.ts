import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Diet, MaritalStatus, type ProfileCardDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { MatrimonySearchStore } from '../data/search.store';
import { ProfileCard } from '../components/profile-card';
import type { AppError } from '../../../core/models/app-error';

/**
 * Faceted search.
 *
 * The filters live in the store rather than in this component, so opening a
 * profile and coming back does not throw away the ten minutes a family spent
 * narrowing them down.
 */
@Component({
  selector: 'eh-matrimony-search-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileCard, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header class="head">
        <div>
          <h1>Find a match</h1>
          <p class="sub">
            Profiles are shown with their guna score against your horoscope.
          </p>
        </div>
        @if (store.activeFilterCount()) {
          <button mat-stroked-button (click)="store.clear()">
            Clear {{ store.activeFilterCount() }} filter(s)
          </button>
        }
      </header>

      <section class="filters">
        <label>
          <span>Community</span>
          <input
            type="text"
            [value]="store.filters().community ?? ''"
            (change)="store.setFilter('community', $any($event.target).value)"
          />
        </label>

        <label>
          <span>City</span>
          <input
            type="text"
            [value]="store.filters().city ?? ''"
            (change)="store.setFilter('city', $any($event.target).value)"
          />
        </label>

        <label>
          <span>Age from</span>
          <input
            type="number"
            min="18"
            max="100"
            [value]="store.filters().ageMin ?? ''"
            (change)="setNumber('ageMin', $any($event.target).value)"
          />
        </label>

        <label>
          <span>Age to</span>
          <input
            type="number"
            min="18"
            max="100"
            [value]="store.filters().ageMax ?? ''"
            (change)="setNumber('ageMax', $any($event.target).value)"
          />
        </label>

        <label>
          <span>Diet</span>
          <select
            [value]="store.filters().diet ?? ''"
            (change)="store.setDiet($any($event.target).value || undefined)"
          >
            <option value="">Any</option>
            @for (d of diets; track d) {
              <option [value]="d">{{ label(d) }}</option>
            }
          </select>
        </label>

        <label>
          <span>Marital status</span>
          <select
            [value]="store.filters().maritalStatus ?? ''"
            (change)="store.setFilter('maritalStatus', $any($event.target).value || undefined)"
          >
            <option value="">Any</option>
            @for (m of maritalStatuses; track m) {
              <option [value]="m">{{ label(m) }}</option>
            }
          </select>
        </label>

        <label>
          <span>Minimum gunas</span>
          <input
            type="number"
            min="0"
            max="36"
            [value]="store.filters().minGunaScore ?? ''"
            (change)="setNumber('minGunaScore', $any($event.target).value)"
          />
        </label>

        <label>
          <span>Sort by</span>
          <select
            [value]="store.filters().sort ?? 'recent'"
            (change)="store.setFilter('sort', $any($event.target).value)"
          >
            <option value="recent">Recently active</option>
            <option value="guna">Guna score</option>
            <option value="age">Age</option>
          </select>
        </label>
      </section>

      <section class="gotra">
        <div class="gotra-input">
          <label>
            <span>Exclude gotra</span>
            <input
              type="text"
              placeholder="e.g. Kashyap"
              [value]="gotraDraft()"
              (input)="gotraDraft.set($any($event.target).value)"
              (keydown.enter)="addGotra()"
            />
          </label>
          <button mat-stroked-button (click)="addGotra()">Add</button>
        </div>

        @if (store.excludedGotras().length) {
          <ul class="chips">
            @for (gotra of store.excludedGotras(); track gotra) {
              <li>
                {{ gotra }}
                <button
                  type="button"
                  (click)="store.removeExcludedGotra(gotra)"
                  [attr.aria-label]="'Stop excluding ' + gotra"
                >×</button>
              </li>
            }
          </ul>
          <p class="hint">
            Profiles from these gotras are removed entirely, not just ranked lower.
          </p>
        }
      </section>

      @if (results.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

      @if (results.error()) {
        <p class="err" role="alert">
          @if (needsProfile()) {
            Create and publish your own profile before searching.
          } @else {
            Search could not be completed. Please try again.
          }
        </p>
      }

      @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

      @for (profile of results.value(); track profile.id) {
        <eh-profile-card
          [profile]="profile"
          (interested)="sendInterest($event)"
          (shortlisted)="toggleShortlist(profile)"
        />
      } @empty {
        @if (!results.isLoading() && !results.error()) {
          <section class="empty">
            <h2>No profiles match</h2>
            <p>Widen the age band, or clear a filter or two.</p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
               gap: 0.75rem; background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
               border-radius: 10px; padding: 1rem; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.7rem;
            text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    input, select { font: inherit; font-size: 0.9rem; padding: 0.4rem 0.5rem;
                    border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px;
                    text-transform: none; letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .gotra { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
             padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .gotra-input { display: flex; gap: 0.6rem; align-items: flex-end; }
    .gotra-input label { flex: 1; max-width: 16rem; }
    .chips { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; padding: 0; }
    .chips li { display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem;
                background: #fdecea; color: #b3261e; border: 1px solid #f7ccc8;
                border-radius: 999px; padding: 0.15rem 0.5rem; }
    .chips button { border: none; background: none; cursor: pointer; color: inherit;
                    font-size: 1rem; line-height: 1; padding: 0; }
    .hint { margin: 0; font-size: 0.78rem; color: rgb(0 0 0 / 0.55); }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6); }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }
  `,
})
export class MatrimonySearchPage {
  private readonly api = inject(MatrimonyApi);
  protected readonly store = inject(MatrimonySearchStore);

  protected readonly diets = Object.values(Diet);
  protected readonly maritalStatuses = Object.values(MaritalStatus);

  protected readonly gotraDraft = signal('');
  protected readonly message = signal<string | null>(null);

  /** Reads the store, so every filter edit re-runs the request by itself. */
  protected readonly results = httpResource<ProfileCardDto[]>(
    () => this.api.searchUrl({ ...this.store.filters(), page: this.store.page() }),
    { parse: unwrap<ProfileCardDto[]>, defaultValue: [] },
  );

  protected needsProfile(): boolean {
    const error = this.results.error() as AppError | undefined;
    return error?.kind === 'server' || error?.code === 'VALIDATION_FAILED';
  }

  protected setNumber(key: 'ageMin' | 'ageMax' | 'minGunaScore', raw: string): void {
    this.store.setFilter(key, raw === '' ? undefined : Number(raw));
  }

  protected addGotra(): void {
    this.store.addExcludedGotra(this.gotraDraft());
    this.gotraDraft.set('');
  }

  protected async sendInterest(profileId: string): Promise<void> {
    this.message.set(null);
    try {
      await this.api.sendInterest(profileId);
      this.results.reload();
      this.message.set('Interest sent.');
    } catch (e) {
      const err = e as AppError;
      // The quota is the upgrade moment, so it gets its own words.
      this.message.set(
        err.code === 'MAT_QUOTA_EXCEEDED'
          ? 'You have used all your interests for today. They reset at midnight.'
          : err.message,
      );
    }
  }

  protected async toggleShortlist(profile: ProfileCardDto): Promise<void> {
    this.message.set(null);
    try {
      if (profile.shortlisted) await this.api.removeShortlist(profile.id);
      else await this.api.shortlist(profile.id);
      this.results.reload();
    } catch (e) {
      this.message.set((e as AppError).message);
    }
  }

  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}
