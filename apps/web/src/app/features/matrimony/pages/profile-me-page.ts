import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import {
  formatInr,
  profileDisplayId,
  type MatrimonyProfileDto,
  type Paisa,
} from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { AuthStore } from '../../auth/data/auth.store';

/**
 * The member's own profile, as a profile rather than as a form.
 *
 * The editor answers "what do I need to change"; this answers "what does this
 * look like to somebody else", which is a different question and the one people
 * actually open their profile to ask. Laid out the way a professional network
 * lays one out - a cover, a portrait breaking the line, the headline underneath,
 * then a column of cards - because that is the shape people already read.
 *
 * Everything here is the member's own data, so nothing is gated. The one thing
 * the page is careful to say out loud is which parts other people cannot see
 * until interest is mutual, because a member who does not know that will not
 * understand why the effort they put into it appears to go unnoticed.
 */
@Component({
  selector: 'eh-matrimony-profile-me-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule],
  template: `
    <main class="wrap">
      @if (profile.value(); as p) {
        <section class="cover">
          <div class="band"></div>

          <div class="identity">
            <span class="portrait">
              @if (avatar(); as url) {
                <img [src]="url" [alt]="p.displayName" />
              } @else {
                <span class="initials">{{ initials() }}</span>
              }
            </span>

            <div class="who">
              <h1>{{ p.displayName }}</h1>
              <p class="headline">{{ headline(p) }}</p>
              <p class="meta">
                {{ p.city }}@if (p.state) {, {{ p.state }}} · {{ p.community }} ·
                {{ p.age }} yrs
              </p>
              <p class="pid">{{ displayId() }}</p>
            </div>

            <div class="actions">
              <a mat-flat-button class="go" routerLink="/matrimony/profile/edit">
                Edit profile
              </a>
              <span class="status" [class.live]="p.status === 'ACTIVE'">
                {{ label(p.status) }}
              </span>
            </div>
          </div>
        </section>

        <section class="card meter-card">
          <div class="meter-head">
            <strong>{{ p.completeness }}% complete</strong>
            <span class="muted">
              @if (p.completeness < 60) {
                60% is needed before it can go live
              } @else if (p.completeness < 100) {
                Every filled-in section puts you in more searches
              } @else {
                Nothing left to add
              }
            </span>
          </div>
          <div class="meter"><span [style.width.%]="p.completeness"></span></div>
        </section>

        @if (p.about) {
          <section class="card">
            <h2>About</h2>
            <p class="prose">{{ p.about }}</p>
          </section>
        }

        <!--
          The professional card is the point of this page. It is also the only
          one with a split audience, so it says so rather than leaving a member
          to guess why an achievement they are proud of draws no response.
        -->
        <section class="card">
          <h2>Work</h2>
          <dl class="facts">
            @if (p.career.occupation) {
              <div><dt>Role</dt><dd>{{ p.career.occupation }}</dd></div>
            }
            @if (p.career.employer) {
              <div><dt>Company</dt><dd>{{ p.career.employer }}</dd></div>
            }
            @if (p.career.yearsOfExperience !== null && p.career.yearsOfExperience !== undefined) {
              <div>
                <dt>Experience</dt>
                <dd>{{ p.career.yearsOfExperience }} years</dd>
              </div>
            }
            @if (p.career.annualIncome) {
              <div>
                <dt>Annual income</dt>
                <dd>
                  {{ inr(p.career.annualIncome) }}
                  <span class="note">shown to others as a band</span>
                </dd>
              </div>
            }
            @if (p.education.highestQualification) {
              <div>
                <dt>Education</dt>
                <dd>{{ p.education.highestQualification }}</dd>
              </div>
            }
          </dl>

          @if (p.career.achievements?.length) {
            <h3>Achievements</h3>
            <ul class="achievements">
              @for (a of p.career.achievements; track a) {
                <li>{{ a }}</li>
              }
            </ul>
            <p class="gated">
              Shown to another member only once interest is mutual, alongside
              your contact details.
            </p>
          } @else {
            <p class="empty">
              No achievements added yet. A promotion, a degree, a business you
              built — specifics a family can ask about are what separate a real
              profile from a filled-in one.
              <a routerLink="/matrimony/profile/edit">Add some</a>
            </p>
          }
        </section>

        <section class="card">
          <h2>Background</h2>
          <dl class="facts">
            <div><dt>Religion</dt><dd>{{ p.religion }}</dd></div>
            <div><dt>Community</dt><dd>{{ p.community }}</dd></div>
            @if (p.gotra) { <div><dt>Gotra</dt><dd>{{ p.gotra }}</dd></div> }
            <div><dt>Mother tongue</dt><dd>{{ p.motherTongue }}</dd></div>
            <div><dt>Marital status</dt><dd>{{ label(p.maritalStatus) }}</dd></div>
            <div><dt>Diet</dt><dd>{{ label(p.diet) }}</dd></div>
            <div><dt>Height</dt><dd>{{ height(p.heightCm) }}</dd></div>
          </dl>
        </section>

        @if (p.horoscope?.nakshatra || p.horoscope?.rashi) {
          <section class="card">
            <h2>Horoscope</h2>
            <dl class="facts">
              @if (p.horoscope.nakshatra) {
                <div><dt>Nakshatra</dt><dd>{{ p.horoscope.nakshatra }}</dd></div>
              }
              @if (p.horoscope.rashi) {
                <div><dt>Rashi</dt><dd>{{ p.horoscope.rashi }}</dd></div>
              }
            </dl>
            <p class="note">
              These two are what the 36-guna score is calculated from. Your birth
              time and place are never shown to anyone.
            </p>
          </section>
        }
      } @else if (!profile.isLoading()) {
        <section class="card empty-state">
          <h2>You do not have a profile yet</h2>
          <p>
            Matches are worked out against it — the community, mother tongue and
            horoscope on it are what decide who you are shown.
          </p>
          <a mat-flat-button class="go" routerLink="/matrimony/profile/edit">
            Create my profile
          </a>
        </section>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 52rem; margin: 1.5rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }

    /* ------------------------------------------------------------- cover */

    .cover { background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
             border-radius: 12px; overflow: hidden; }
    .band { height: clamp(5rem, 14vw, 8rem);
            background: linear-gradient(120deg, var(--brand-deep), var(--brand)); }
    .identity { display: grid; grid-template-columns: auto 1fr auto;
                gap: 0 1.1rem; padding: 0 1.5rem 1.4rem; align-items: end; }

    /* The portrait breaks the band, which is what makes the layout read as a
       profile rather than as another card with a picture in it. */
    .portrait { display: grid; place-items: center; width: 7rem; height: 7rem;
                margin-top: -3.5rem; border-radius: 50%; overflow: hidden;
                border: 4px solid #fff; background: var(--brand-tint);
                color: var(--brand); font-size: 1.8rem; font-weight: 700; }
    .portrait img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .who { padding-bottom: 0.2rem; min-width: 0; }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--brand-deep); }
    .headline { margin: 0.2rem 0 0; font-size: 0.98rem; color: rgb(0 0 0 / 0.78); }
    .meta { margin: 0.3rem 0 0; font-size: 0.86rem; color: rgb(0 0 0 / 0.55); }
    .pid { margin: 0.15rem 0 0; font-size: 0.74rem; letter-spacing: 0.04em;
           color: rgb(0 0 0 / 0.4); }

    .actions { display: flex; flex-direction: column; align-items: flex-end;
               gap: 0.5rem; padding-bottom: 0.3rem; }
    .go { background: var(--brand) !important; color: #fff !important; font-weight: 700; }
    .status { font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
              letter-spacing: 0.05em; background: #eceff1; color: #37474f;
              border-radius: 999px; padding: 0.2rem 0.55rem; }
    .status.live { background: #e6f4ea; color: #1b5e20; }

    /* -------------------------------------------------------------- cards */

    .card { background: #fff; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 12px; padding: 1.25rem 1.5rem; }
    h2 { margin: 0 0 0.8rem; font-size: 1.05rem; font-weight: 700;
         color: var(--brand-deep); }
    h3 { margin: 1.1rem 0 0.5rem; font-size: 0.72rem; font-weight: 700;
         letter-spacing: 0.06em; text-transform: uppercase; color: rgb(0 0 0 / 0.5); }
    .prose { margin: 0; line-height: 1.65; color: rgb(0 0 0 / 0.8); }

    .facts { margin: 0; display: grid; gap: 0.7rem 1.5rem;
             grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); }
    .facts > div { min-width: 0; }
    dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: rgb(0 0 0 / 0.45); }
    dd { margin: 0.1rem 0 0; font-size: 0.95rem; color: rgb(0 0 0 / 0.85); }

    .achievements { margin: 0; padding-left: 1.1rem; display: flex;
                    flex-direction: column; gap: 0.4rem; }
    .achievements li { line-height: 1.5; color: rgb(0 0 0 / 0.82); }

    .note { font-size: 0.78rem; color: rgb(0 0 0 / 0.5); }
    dd .note { display: block; }
    .gated { margin: 0.7rem 0 0; font-size: 0.8rem; color: var(--brand-ink);
             background: var(--brand-tint); border: 1px solid var(--brand-line);
             border-radius: 8px; padding: 0.5rem 0.7rem; }
    .empty { margin: 0.6rem 0 0; font-size: 0.88rem; line-height: 1.6;
             color: rgb(0 0 0 / 0.6); }
    .empty a, .prose a { color: var(--brand); font-weight: 600; }

    .meter-card { display: flex; flex-direction: column; gap: 0.55rem; }
    .meter-head { display: flex; gap: 0.7rem; align-items: baseline;
                  flex-wrap: wrap; font-size: 0.92rem; }
    .muted { color: rgb(0 0 0 / 0.55); font-size: 0.82rem; }
    .meter { width: 100%; height: 8px; border-radius: 999px; background: #eceff1;
             overflow: hidden; }
    .meter span { display: block; height: 100%; background: var(--brand); }

    .empty-state { text-align: center; display: flex; flex-direction: column;
                   align-items: center; gap: 0.7rem; padding: 2.5rem 1.5rem; }

    @media (max-width: 640px) {
      .identity { grid-template-columns: 1fr; gap: 0.6rem; }
      .actions { align-items: flex-start; flex-direction: row; }
    }
  `,
})
export class MatrimonyProfileMePage {
  private readonly api = inject(MatrimonyApi);
  private readonly store = inject(AuthStore);

  protected readonly profile = httpResource<MatrimonyProfileDto | null>(
    () => this.api.meUrl,
    { parse: unwrap<MatrimonyProfileDto | null>, defaultValue: null },
  );

  protected readonly displayId = computed(() => {
    const id = this.profile.value()?.id;
    return id ? profileDisplayId(id) : '';
  });

  /** Only an approved photo, for the same reason the masthead avatar is. */
  protected readonly avatar = computed(() => {
    const photos = this.profile.value()?.photos ?? [];
    const primary = photos.find((p) => p.isPrimary && p.moderation === 'APPROVED');
    return (primary ?? photos.find((p) => p.moderation === 'APPROVED'))?.url ?? null;
  });

  protected readonly initials = computed(() =>
    (this.profile.value()?.displayName || this.store.displayName() || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join(''),
  );

  /** "Software Engineer at Capital One", or as much of it as exists. */
  protected headline(p: MatrimonyProfileDto): string {
    const role = p.career.occupation;
    const at = p.career.employer;
    if (role && at) return `${role} at ${at}`;
    return role || at || p.education.highestQualification || 'Profile';
  }

  protected height(cm: number): string {
    const inches = Math.round(cm / 2.54);
    return `${Math.floor(inches / 12)}'${inches % 12}" (${cm} cm)`;
  }

  protected inr(paisa: number): string {
    return formatInr(paisa as Paisa);
  }

  protected label(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
