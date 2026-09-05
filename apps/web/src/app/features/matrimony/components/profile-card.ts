import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import type { ProfileCardDto } from '@eventhub/contracts';

import { GunaBadge } from './guna-badge';

/**
 * One profile, as it appears in search, interests and the shortlist.
 *
 * A withheld photo shows a placeholder that says so rather than an empty frame:
 * "photo shared after mutual interest" is information a family acts on, while a
 * blank square just looks broken.
 */
@Component({
  selector: 'eh-profile-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GunaBadge, MatButtonModule],
  template: `
    <article class="card">
      <a class="photo" [routerLink]="['/matrimony/profile', profile().id]">
        @if (profile().photoUrl) {
          <img [src]="profile().photoUrl" [alt]="profile().displayName" />
        } @else if (profile().photosBlurred) {
          <div class="locked">
            <span class="icon">🔒</span>
            <span>Photo shared<br />after mutual interest</span>
          </div>
        } @else {
          <div class="locked"><span class="icon">👤</span><span>No photo yet</span></div>
        }
      </a>

      <div class="body">
        <div class="head">
          <a class="name" [routerLink]="['/matrimony/profile', profile().id]">
            {{ profile().displayName }}
          </a>
          @if (profile().gunaScore !== null) {
            <eh-guna-badge [score]="profile().gunaScore!" />
          }
        </div>

        <p class="line">
          {{ profile().age }} yrs · {{ height() }} · {{ profile().community }}
        </p>
        <p class="line muted">
          {{ profile().education }}@if (profile().occupation) {
            , {{ profile().occupation }}
          }
        </p>
        <p class="line muted">{{ profile().city }}</p>

        <div class="actions">
          @switch (profile().interestStatus) {
            @case ('SENT') { <span class="state">Interest sent</span> }
            @case ('ACCEPTED') { <span class="state good">Accepted ✓</span> }
            @case ('DECLINED') { <span class="state">Declined</span> }
            @default {
              <button mat-flat-button (click)="interested.emit(profile().id)">
                Send interest
              </button>
            }
          }

          <button
            mat-stroked-button
            [attr.aria-pressed]="profile().shortlisted"
            (click)="shortlisted.emit(profile().id)"
          >
            {{ profile().shortlisted ? '★ Saved' : '☆ Save' }}
          </button>
        </div>
      </div>
    </article>
  `,
  styles: `
    .card { display: flex; gap: 1rem; border: 1px solid rgb(0 0 0 / 0.12);
            border-radius: 10px; background: #fff; overflow: hidden; }
    .photo { flex: none; width: 8.5rem; background: #f3f1ea; display: block; }
    .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .locked { height: 100%; min-height: 9.5rem; display: flex; flex-direction: column;
              align-items: center; justify-content: center; gap: 0.4rem;
              font-size: 0.68rem; line-height: 1.35; text-align: center;
              color: rgb(0 0 0 / 0.5); padding: 0.5rem; }
    .icon { font-size: 1.3rem; }
    .body { flex: 1; padding: 0.9rem 1rem 0.9rem 0;
            display: flex; flex-direction: column; gap: 0.25rem; }
    .head { display: flex; align-items: center; justify-content: space-between;
            gap: 0.75rem; }
    .name { font-size: 1.02rem; font-weight: 600; color: inherit; text-decoration: none; }
    .name:hover { text-decoration: underline; }
    .line { margin: 0; font-size: 0.87rem; }
    .muted { color: rgb(0 0 0 / 0.6); }
    .actions { display: flex; gap: 0.5rem; margin-top: auto; padding-top: 0.6rem;
               flex-wrap: wrap; align-items: center; }
    .state { font-size: 0.78rem; font-weight: 700; color: rgb(0 0 0 / 0.5);
             text-transform: uppercase; letter-spacing: 0.04em; }
    .state.good { color: #1b5e20; }
    @media (max-width: 520px) {
      .card { flex-direction: column; }
      .photo { width: 100%; height: 12rem; }
      .body { padding: 0 1rem 1rem; }
    }
  `,
})
export class ProfileCard {
  readonly profile = input.required<ProfileCardDto>();

  readonly interested = output<string>();
  readonly shortlisted = output<string>();

  /** 165 cm reads as 5'5" to most families looking at this. */
  protected height(): string {
    const cm = this.profile().heightCm;
    const inches = Math.round(cm / 2.54);
    return `${Math.floor(inches / 12)}'${inches % 12}" (${cm} cm)`;
  }
}
