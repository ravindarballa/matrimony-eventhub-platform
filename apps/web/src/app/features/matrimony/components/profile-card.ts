import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import type { ProfileCardDto } from '@eventhub/contracts';

import { GunaBadge } from './guna-badge';

/**
 * One profile, as a tile in search, interests and the shortlist.
 *
 * A tile rather than a wide row: browsing profiles is looking at photographs,
 * and a row gives the photo a thumbnail's worth of space while spending the
 * width on text nobody reads until the picture has already interested them. A
 * grid of tiles puts four faces on screen where a list put one and a half.
 *
 * The photo is 4:5 because that is the shape portraits are taken and cropped
 * in; a square crops heads, and a landscape frame is mostly background.
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

        @if (profile().gunaScore !== null) {
          <span class="guna"><eh-guna-badge [score]="profile().gunaScore!" /></span>
        }
      </a>

      <div class="body">
        <a class="name" [routerLink]="['/matrimony/profile', profile().id]">
          {{ profile().displayName }}
        </a>

        <p class="line">{{ profile().age }} yrs · {{ height() }}</p>
        <p class="line muted">{{ profile().community }} · {{ profile().city }}</p>
        <p class="line muted job">
          {{ profile().education }}@if (profile().occupation) {
            , {{ profile().occupation }}
          }
        </p>

        <div class="actions">
          @switch (profile().interestStatus) {
            @case ('SENT') { <span class="state">Interest sent</span> }
            @case ('ACCEPTED') { <span class="state good">Accepted ✓</span> }
            @case ('DECLINED') { <span class="state">Declined</span> }
            @default {
              <button mat-flat-button class="send" (click)="interested.emit(profile().id)">
                Send interest
              </button>
            }
          }

          <button
            mat-stroked-button
            class="save"
            [attr.aria-pressed]="profile().shortlisted"
            (click)="shortlisted.emit(profile().id)"
          >
            {{ profile().shortlisted ? '★' : '☆' }}
          </button>
        </div>
      </div>
    </article>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .card { height: 100%; display: flex; flex-direction: column;
            border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px;
            background: #fff; overflow: hidden;
            transition: transform 120ms ease, box-shadow 120ms ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgb(0 0 0 / 0.1); }

    .photo { position: relative; display: block; aspect-ratio: 4 / 5;
             background: #f3f1ea; }
    .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .locked { position: absolute; inset: 0; display: flex; flex-direction: column;
              align-items: center; justify-content: center; gap: 0.4rem;
              font-size: 0.72rem; line-height: 1.35; text-align: center;
              color: rgb(0 0 0 / 0.5); padding: 0.6rem; }
    .icon { font-size: 1.5rem; }
    /* Over the photo, where it reads as a property of the face rather than
       another line of text competing with the name. */
    .guna { position: absolute; top: 0.5rem; right: 0.5rem; }

    .body { flex: 1; padding: 0.8rem 0.9rem 0.9rem;
            display: flex; flex-direction: column; gap: 0.2rem; }
    .name { font-size: 1rem; font-weight: 600; color: inherit; text-decoration: none;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name:hover { text-decoration: underline; }
    .line { margin: 0; font-size: 0.84rem; }
    .muted { color: rgb(0 0 0 / 0.6); }
    /* Two lines at most, so one long job title cannot make a tile taller than
       its neighbours and leave a hole in the grid. */
    .job { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
           overflow: hidden; }

    .actions { display: flex; gap: 0.4rem; align-items: center;
               margin-top: auto; padding-top: 0.7rem; }
    .send { flex: 1; font-size: 0.82rem; }
    .save { min-width: 2.6rem; padding: 0 0.6rem; }
    .state { flex: 1; font-size: 0.75rem; font-weight: 700; color: rgb(0 0 0 / 0.5);
             text-transform: uppercase; letter-spacing: 0.04em; }
    .state.good { color: #1b5e20; }
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
