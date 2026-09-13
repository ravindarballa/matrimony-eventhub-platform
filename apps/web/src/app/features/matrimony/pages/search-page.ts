import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  COMMUNITIES_BY_RELIGION,
  Diet,
  MaritalStatus,
  type ProfileCardDto,
} from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { MatrimonySearchStore } from '../data/search.store';
import { ProfileCard } from '../components/profile-card';
import type { AppError } from '../../../core/models/app-error';

/**
 * Faceted search.
 *
 * Laid out to the matrimony reference this side of the product follows: a
 * standing filter rail down the left, and results as wide rows beside it. The
 * filters were a band across the top, which works while there are eight of them
 * and stops working the moment there are twelve - and a family narrowing a
 * search wants to see what they have already narrowed without scrolling back up
 * past the results to check.
 *
 * The filters live in the store rather than in this component, so opening a
 * profile and coming back does not throw away the ten minutes a family spent
 * narrowing them down.
 */
@Component({
  selector: 'eh-matrimony-search-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ProfileCard, MatButtonModule, MatProgressBarModule],
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

      <!--
        No profile, no search. The API refuses the query outright - it has no
        gender, community or horoscope to match against - so the filters are a
        rail for a search that cannot run. Showing them next to one red sentence
        left three quarters of the page blank and read as a broken layout rather
        than as the one thing the visitor has to do next.
      -->
      @if (needsProfile()) {
        <section class="gate">
          <h2>Create your profile to see matches</h2>
          <p>
            Matches are worked out against your own profile — the community,
            mother tongue and horoscope on it are what decide who you are shown,
            and whose search you appear in. It takes three short steps.
          </p>
          <div class="gateActions">
            <a mat-flat-button class="go" routerLink="/matrimony/profile/edit">
              Create my profile
            </a>
            <a mat-stroked-button routerLink="/">Back to home</a>
          </div>
          <p class="fine">
            Already filled it in? It also has to be published before searching —
            open it and choose <strong>Publish</strong>.
          </p>
        </section>
      } @else {

      <div class="layout">
      <aside class="rail">
        <h2 class="railhead">Refine</h2>

        <section class="filters">
        <label>
          <span>Community</span>
          <!--
            Grouped by religion, because the filter has no religion of its own
            to scope by and a flat hundred-item list is unreadable. The groups
            are the only thing that makes it scannable.
          -->
          <select
            [value]="store.filters().community ?? ''"
            (change)="store.setFilter('community', $any($event.target).value)"
          >
            <option value="">Any</option>
            @for (group of communityGroups; track group.religion) {
              <optgroup [label]="group.religion">
                @for (c of group.communities; track c) {
                  <option [value]="c" [selected]="c === store.filters().community">
                    {{ c }}
                  </option>
                }
              </optgroup>
            }
          </select>
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
      </aside>

      <section class="results">
        <!--
          Count on the left, sort on the right, directly above the rows. The
          sort belongs here rather than in the rail: it does not narrow anything,
          it reorders what is already on screen, and putting it among the filters
          invited people to hunt for it there when they wanted fewer results.
        -->
        <div class="sortbar">
          <p class="tally">
            @if (results.isLoading()) {
              Searching…
            } @else {
              <strong>{{ results.value().length }}</strong>
              {{ results.value().length === 1 ? 'profile' : 'profiles' }}
              @if (store.activeFilterCount()) { match your filters }
            }
          </p>

          <label class="sort">
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
        </div>

        @if (results.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

        @if (results.error()) {
          <p class="err" role="alert">Search could not be completed. Please try again.</p>
        }

        @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

        <div class="rows">
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
        </div>
      </section>
      </div>
      }
    </main>
  `,
  styles: `
    /* Rows, one per profile, in a single column beside the filter rail. */
    .rows { display: flex; flex-direction: column; gap: 0.8rem; }

    .wrap { max-width: 78rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }

    /* The rail is a fixed column and the results take the rest. It sticks,
       because the whole point of a standing rail is that a family can change
       one filter after scrolling through forty profiles without going back to
       the top of the page to find it. */
    .layout { display: grid; grid-template-columns: 15rem 1fr; gap: 1.25rem;
              align-items: start; }
    /*
     * Sticky, but never its own scroll area. Capping the height at the viewport
     * and setting overflow-y gave the rail an inner scrollbar that clipped the
     * first filter off the top - two nested scrollbars on one page, and the
     * control a family wanted hidden inside the inner one. Left to its natural
     * height it simply scrolls with the page when it does not fit, which is what
     * a filter rail should do.
     */
    /*
     * The rail scrolls with the page. It is deliberately NOT sticky.
     *
     * Sticky looked right and was unusable: the filters are taller than a
     * laptop viewport, and a pinned element taller than the screen can never be
     * seen in full - scroll down and its top is cut off, scroll up and its
     * bottom is. Measured at a 620px viewport the top 36px were unreachable at
     * every scroll position.
     *
     * The fix before this one was to give the rail its own scrollbar, which
     * traded an unreachable strip for two nested scrollbars and a first filter
     * clipped mid-control. Letting it scroll with the results is the version
     * with no failure mode: everything is reachable, and the page behaves the
     * way the right-hand column already did.
     */
    .rail { display: flex; flex-direction: column; gap: 0.8rem; }
    .railhead { margin: 0; font-size: 0.72rem; font-weight: 700;
                letter-spacing: 0.09em; text-transform: uppercase;
                color: rgb(0 0 0 / 0.42); }

    .filters { display: flex; flex-direction: column;
               gap: 0.75rem; background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
               border-radius: 10px; padding: 1rem; }

    .results { min-width: 0; display: flex; flex-direction: column; gap: 0.8rem; }
    .sortbar { display: flex; align-items: center; justify-content: space-between;
               gap: 1rem; flex-wrap: wrap; }
    .tally { margin: 0; font-size: 0.88rem; color: rgb(0 0 0 / 0.6); }
    .tally strong { color: var(--brand-deep); font-size: 1.05rem; }
    .sort { flex-direction: row; align-items: center; gap: 0.5rem; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.7rem;
            text-transform: uppercase; letter-spacing: 0.05em; color: rgb(0 0 0 / 0.55); }
    input, select { font: inherit; font-size: 0.9rem; padding: 0.4rem 0.5rem;
                    border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px;
                    text-transform: none; letter-spacing: normal; color: rgb(0 0 0 / 0.87); }
    .gotra { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
             padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .gotra-input { display: flex; gap: 0.5rem; align-items: flex-end; }
    .gotra-input label { flex: 1; min-width: 0; }
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
    .empty { text-align: center; padding: 3rem 1rem; color: rgb(0 0 0 / 0.6);
             background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
             border-radius: 10px; }
    .empty h2 { font-size: 1.1rem; margin: 0 0 0.4rem; }
    .err { color: #b3261e; font-size: 0.9rem; }

    /* The gate takes the whole width, because it is the whole page: there is
       nothing else to do here until the profile exists. */
    .gate { background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 12px; padding: clamp(2rem, 5vw, 3.5rem);
            text-align: center; display: flex; flex-direction: column;
            align-items: center; gap: 0.9rem; }
    .gate h2 { margin: 0; font-size: clamp(1.25rem, 3vw, 1.7rem); color: var(--brand);
               letter-spacing: -0.015em; }
    .gate p { margin: 0; max-width: 54ch; line-height: 1.65; font-size: 0.95rem;
              color: rgb(0 0 0 / 0.66); }
    .gateActions { display: flex; flex-wrap: wrap; gap: 0.6rem;
                   justify-content: center; margin-top: 0.4rem; }
    .gate .go { background: var(--brand) !important; color: #fff !important;
                font-weight: 700; }
    .gate .fine { font-size: 0.83rem; color: rgb(0 0 0 / 0.5); }

    /* The rail stops being a rail and becomes a block above the results. It is
       not hidden: on a phone the filters are the only way through 200 profiles. */
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .rail { max-height: none; overflow: visible; }
      .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
    }
  `,
})
export class MatrimonySearchPage {
  private readonly api = inject(MatrimonyApi);
  protected readonly store = inject(MatrimonySearchStore);

  /** Every community, kept under its religion so the list can be scanned. */
  protected readonly communityGroups = Object.entries(COMMUNITIES_BY_RELIGION)
    .filter(([, communities]) => communities.length > 0)
    .map(([religion, communities]) => ({ religion, communities }));

  protected readonly diets = Object.values(Diet);
  protected readonly maritalStatuses = Object.values(MaritalStatus);

  /**
   * Filters arriving in the URL, bound from the query string by
   * withComponentInputBinding.
   *
   * This is what makes the home page's search box mean anything: someone picks
   * an age range and a mother tongue there, signs in on the way through, and
   * has to arrive at those results rather than at an empty search. They seed
   * the store once, on the way in, and after that the store is in charge -
   * otherwise editing a filter here would fight the URL that opened the page.
   */
  readonly ageMin = input<string | undefined>(undefined);
  readonly ageMax = input<string | undefined>(undefined);
  readonly religion = input<string | undefined>(undefined);
  readonly motherTongue = input<string | undefined>(undefined);

  private seeded = false;

  protected readonly gotraDraft = signal('');
  protected readonly message = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.seeded) return;

      const age = (raw: string | undefined): number | undefined => {
        const n = Number(raw);
        return raw && Number.isFinite(n) && n > 0 ? n : undefined;
      };

      const incoming = {
        ageMin: age(this.ageMin()),
        ageMax: age(this.ageMax()),
        religion: this.religion() || undefined,
        motherTongue: this.motherTongue() || undefined,
      };
      if (Object.values(incoming).every((v) => v === undefined)) return;

      this.seeded = true;
      for (const [key, value] of Object.entries(incoming)) {
        if (value !== undefined) {
          this.store.setFilter(key as never, value as never);
        }
      }
    });
  }

  /** Reads the store, so every filter edit re-runs the request by itself. */
  protected readonly results = httpResource<ProfileCardDto[]>(
    () => this.api.searchUrl({ ...this.store.filters(), page: this.store.page() }),
    { parse: unwrap<ProfileCardDto[]>, defaultValue: [] },
  );

  /**
   * The viewer has no profile, so the search was refused outright.
   *
   * Keyed on the code alone. It used to also treat any 'server' error as a
   * missing profile, which meant a genuine 500 told the visitor to go and
   * create a profile they already had - and sent them off to fix something that
   * was never broken.
   */
  protected needsProfile(): boolean {
    return (this.results.error() as AppError | undefined)?.code === 'VALIDATION_FAILED';
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
