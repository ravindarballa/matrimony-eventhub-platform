import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { ProfileDetailDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { GunaBadge } from '../components/guna-badge';
import type { AppError } from '../../../core/models/app-error';

/**
 * One profile in full, including the Ashtakoota breakdown.
 *
 * The eight kootas are shown with their reasoning rather than as a single
 * number, because a family will check it against their own astrologer and a
 * bare total tells them nothing about where the match is weak. Nadi scoring
 * zero is the one every family looks for first.
 */
@Component({
  selector: 'eh-matrimony-profile-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GunaBadge, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <a class="back" routerLink="/matrimony/search">&larr; Back to search</a>

      @if (profile.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

      @if (profile.error()) {
        <p class="err" role="alert">
          This profile is not available. It may have been hidden or removed.
        </p>
      }

      @if (profile.value(); as p) {
        <header class="head">
          <div class="identity">
            @if (p.photoUrl) {
              <img class="photo" [src]="p.photoUrl" [alt]="p.displayName" />
            } @else {
              <div class="photo locked">
                <span>🔒</span>
                <small>Photo shared after mutual interest</small>
              </div>
            }
            <div>
              <h1>{{ p.displayName }}</h1>
              <p class="line">
                {{ p.age }} yrs · {{ height(p.heightCm) }} · {{ label(p.maritalStatus) }}
              </p>
              <p class="line muted">
                {{ p.community }} · {{ p.religion }} · {{ p.motherTongue }}
              </p>
              <p class="line muted">{{ p.city }}</p>
              @if (p.gunaScore !== null) {
                <div class="badge-row">
                  <eh-guna-badge [score]="p.gunaScore!" />
                  <span class="managed">Managed by {{ label(p.managedBy) }}</span>
                </div>
              }
            </div>
          </div>
        </header>

        @if (message(); as m) { <p class="notice" role="status">{{ m }}</p> }

        <section class="actions">
          @switch (p.interestStatus) {
            @case ('SENT') { <span class="state">Interest sent — waiting for a reply</span> }
            @case ('ACCEPTED') { <span class="state good">Interest accepted ✓</span> }
            @case ('DECLINED') { <span class="state">This interest was declined</span> }
            @default {
              <button mat-flat-button [disabled]="busy()" (click)="sendInterest(p.id)">
                Send interest
              </button>
            }
          }
          <button mat-stroked-button [disabled]="busy()" (click)="toggleShortlist(p)">
            {{ p.shortlisted ? '★ Saved' : '☆ Save to shortlist' }}
          </button>
          <button mat-button class="danger" [disabled]="busy()" (click)="block(p.id)">
            Block
          </button>
        </section>

        @if (p.contact) {
          <section class="panel contact">
            <h2>Contact</h2>
            <p class="phone">+91 {{ p.contact.mobile }}</p>
            <p class="hint">
              Shared because you both accepted. The number belongs to whoever manages
              the profile — {{ label(p.contact.managedBy) }}.
            </p>
          </section>
        } @else {
          <section class="panel locked-contact">
            <h2>Contact</h2>
            <p class="hint">
              Phone numbers are shared only when both sides accept an interest.
            </p>
          </section>
        }

        @if (p.about) {
          <section class="panel">
            <h2>About</h2>
            <p>{{ p.about }}</p>
          </section>
        }

        <section class="panel">
          <h2>Education &amp; career</h2>
          <dl>
            <div><dt>Qualification</dt><dd>{{ p.educationDetails.highestQualification || '—' }}</dd></div>
            @if (p.educationDetails.fieldOfStudy) {
              <div><dt>Field</dt><dd>{{ p.educationDetails.fieldOfStudy }}</dd></div>
            }
            <div><dt>Occupation</dt><dd>{{ p.career.occupation || '—' }}</dd></div>
            @if (p.career.incomeBand) {
              <div><dt>Income</dt><dd>{{ p.career.incomeBand }}</dd></div>
            }
          </dl>
        </section>

        <section class="panel">
          <h2>Family</h2>
          <dl>
            <div><dt>Father</dt><dd>{{ p.family.fatherOccupation || '—' }}</dd></div>
            <div><dt>Mother</dt><dd>{{ p.family.motherOccupation || '—' }}</dd></div>
            <div><dt>Siblings</dt><dd>{{ p.family.siblings ?? '—' }}</dd></div>
            <div><dt>Native place</dt><dd>{{ p.family.nativePlace || '—' }}</dd></div>
          </dl>
        </section>

        @if (p.compatibility; as guna) {
          <section class="panel">
            <div class="guna-head">
              <h2>Horoscope match</h2>
              <eh-guna-badge [score]="guna.total" />
            </div>

            <table class="kootas">
              <tbody>
                @for (koota of guna.kootas; track koota.koota) {
                  <tr [class.zero]="koota.points === 0">
                    <td class="k">{{ koota.koota }}</td>
                    <td class="pts">{{ koota.points }}/{{ koota.max }}</td>
                    <td class="note">{{ koota.note }}</td>
                  </tr>
                }
                <tr class="total">
                  <td class="k">Total</td>
                  <td class="pts">{{ guna.total }}/36</td>
                  <td class="note">{{ verdictText(guna.verdict) }}</td>
                </tr>
              </tbody>
            </table>

            <p class="dosha" [class.warn]="!guna.mangalDosha.compatible">
              <strong>Mangal Dosha:</strong> {{ guna.mangalDosha.note }}
            </p>
          </section>
        } @else {
          <section class="panel">
            <h2>Horoscope match</h2>
            <p class="hint">
              A guna score needs a nakshatra and rashi on both profiles.
              <a routerLink="/matrimony/profile/edit">Add yours</a> to see this.
            </p>
          </section>
        }
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 46rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    .back { font-size: 0.85rem; color: #2f2d78; text-decoration: none; }
    .back:hover { text-decoration: underline; }
    .identity { display: flex; gap: 1.25rem; align-items: flex-start; }
    .photo { width: 9rem; height: 11rem; object-fit: cover; border-radius: 10px;
             background: #f3f1ea; flex: none; }
    .photo.locked { display: flex; flex-direction: column; align-items: center;
                    justify-content: center; gap: 0.4rem; text-align: center;
                    color: rgb(0 0 0 / 0.5); font-size: 1.4rem; padding: 0.75rem; }
    .photo.locked small { font-size: 0.66rem; line-height: 1.35; }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 600; }
    .line { margin: 0.25rem 0 0; font-size: 0.9rem; }
    .muted { color: rgb(0 0 0 / 0.6); }
    .badge-row { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.6rem; }
    .managed { font-size: 0.75rem; color: rgb(0 0 0 / 0.5); }
    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
    .danger { color: #b3261e; }
    .state { font-size: 0.85rem; font-weight: 600; color: rgb(0 0 0 / 0.6); }
    .state.good { color: #1b5e20; }
    .panel { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
             padding: 1.1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .panel h2 { margin: 0; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em;
                text-transform: uppercase; color: rgb(0 0 0 / 0.55); }
    .panel p { margin: 0; font-size: 0.9rem; }
    .contact { border-color: #c8e6c9; background: #f6fbf7; }
    .phone { font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .locked-contact { background: #fafafa; }
    .hint { font-size: 0.85rem; color: rgb(0 0 0 / 0.6); }
    dl { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
         gap: 0.6rem; }
    dl div { display: flex; flex-direction: column; gap: 0.1rem; }
    dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: rgb(0 0 0 / 0.5); }
    dd { margin: 0; font-size: 0.9rem; }
    .guna-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .kootas { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .kootas td { padding: 0.4rem 0.5rem 0.4rem 0; border-top: 1px solid rgb(0 0 0 / 0.07);
                 vertical-align: top; }
    .k { font-weight: 600; white-space: nowrap; }
    .pts { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right;
           padding-right: 0.9rem !important; }
    .note { color: rgb(0 0 0 / 0.6); }
    tr.zero .pts { color: #b3261e; font-weight: 700; }
    tr.total td { border-top: 2px solid rgb(0 0 0 / 0.15); font-weight: 700; }
    .dosha { font-size: 0.85rem; background: #f6fbf7; border-left: 3px solid #1b5e20;
             padding: 0.6rem 0.8rem; border-radius: 0 6px 6px 0; }
    .dosha.warn { background: #fbf1dc; border-left-color: #c98a16; color: #6b4600; }
    .notice { margin: 0; font-size: 0.88rem; color: #0d47a1; background: #e3f2fd;
              border-left: 3px solid #0d47a1; padding: 0.6rem 0.8rem;
              border-radius: 0 6px 6px 0; }
    .err { color: #b3261e; font-size: 0.9rem; }
    @media (max-width: 520px) {
      .identity { flex-direction: column; }
      .photo { width: 100%; height: 14rem; }
    }
  `,
})
export class MatrimonyProfileDetailPage {
  private readonly api = inject(MatrimonyApi);

  readonly id = input.required<string>();

  protected readonly profile = httpResource<ProfileDetailDto>(
    () => this.api.profileUrl(this.id()),
    { parse: unwrap<ProfileDetailDto> },
  );

  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  protected async sendInterest(profileId: string): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await this.api.sendInterest(profileId);
      this.profile.reload();
    } catch (e) {
      const err = e as AppError;
      this.message.set(
        err.code === 'MAT_QUOTA_EXCEEDED'
          ? 'You have used all your interests for today. They reset at midnight.'
          : err.message,
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleShortlist(p: ProfileDetailDto): Promise<void> {
    this.busy.set(true);
    try {
      if (p.shortlisted) await this.api.removeShortlist(p.id);
      else await this.api.shortlist(p.id);
      this.profile.reload();
    } catch (e) {
      this.message.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async block(profileId: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.block(profileId);
      // The profile is now invisible in both directions, so reloading it 404s -
      // which is the correct outcome, and what the error state above renders.
      this.profile.reload();
    } catch (e) {
      this.message.set((e as AppError).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly label = (value: string): string =>
    value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

  protected height(cm: number): string {
    const inches = Math.round(cm / 2.54);
    return `${Math.floor(inches / 12)}'${inches % 12}" (${cm} cm)`;
  }

  protected verdictText(verdict: string): string {
    return {
      EXCELLENT: 'An excellent match by the traditional reading.',
      GOOD: 'A good match.',
      ACCEPTABLE: 'Acceptable — 18 is the usual minimum.',
      POOR: 'Below the usual minimum of 18.',
    }[verdict] ?? '';
  }
}
