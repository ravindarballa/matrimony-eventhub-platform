import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { profileDisplayId, type ProfileCardDto } from '@eventhub/contracts';

import { GunaBadge } from './guna-badge';

/**
 * One profile, as a wide row in search, interests and the shortlist.
 *
 * A row rather than a tile, following the matrimony reference this side of the
 * product is built against. The two shapes answer different questions. A tile
 * grid asks "which face do you like", which is how a photo site works; a row
 * asks "does this person fit", which is how a family reads a matrimony listing -
 * community, mother tongue, education, job and city, checked in that order
 * before the photo has finished loading. The row has the width to show all of
 * them at once, so a family rules profiles out from the list instead of opening
 * each one to find the mother tongue.
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
    <article class="row">
      <a class="photo" [routerLink]="['/matrimony/profile', profile().id]">
        @if (profile().photoUrl) {
          <img [src]="profile().photoUrl" [alt]="profile().displayName" loading="lazy" />
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
        <header class="top">
          <div class="who">
            <a class="name" [routerLink]="['/matrimony/profile', profile().id]">
              {{ profile().displayName }}
            </a>
            <span class="pid">{{ displayId() }}</span>
          </div>
        </header>

        <!--
          The particulars, as a definition list. A matrimony listing is read by
          scanning down the same fields on every row, so they are laid out on a
          fixed grid rather than run together as a sentence - the eye finds
          "Mother tongue" in the same place on row nine as on row one.
        -->
        <dl class="facts">
          <div><dt>Age / Height</dt><dd>{{ profile().age }} yrs, {{ height() }}</dd></div>
          <div><dt>Community</dt><dd>{{ profile().community }}</dd></div>
          <div><dt>Mother tongue</dt><dd>{{ profile().motherTongue }}</dd></div>
          <div><dt>Status</dt><dd>{{ label(profile().maritalStatus) }}</dd></div>
          <div><dt>Education</dt><dd>{{ profile().education || '—' }}</dd></div>
          <div><dt>Occupation</dt><dd>{{ profile().occupation || '—' }}</dd></div>
          <div><dt>Location</dt><dd>{{ profile().city }}</dd></div>
          <div><dt>Religion</dt><dd>{{ profile().religion }}</dd></div>
        </dl>
      </div>

      <!--
        The actions are a column of their own on the right, which is where the
        reference puts them and what stops every row being half empty. The
        particulars are short - "Hindi", "Delhi", "Never married" - so given the
        whole width they strand a third of the card in whitespace with the
        buttons orphaned underneath. As a rail they close the row off, and the
        guna score sits at the top of it where the eye lands after the name.
      -->
      <aside class="side">
        @if (profile().gunaScore !== null) {
          <span class="guna">
            <eh-guna-badge [score]="profile().gunaScore!" />
          </span>
        }

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
          {{ profile().shortlisted ? '★ Shortlisted' : '☆ Shortlist' }}
        </button>

        <a mat-button class="view" [routerLink]="['/matrimony/profile', profile().id]">
          View full profile
        </a>
      </aside>
    </article>
  `,
  styles: `
    /*
     * A container, so the card sizes itself against the box it was put in.
     * The breakpoints below used to be @media, which asks about the VIEWPORT -
     * and the card is dropped into tile grids that are a fraction of it. On a
     * 1440px desktop the media query said "plenty of room" while the actual
     * track was 224px, so the fixed 10rem and 11rem tracks overflowed, the
     * particulars column was crushed to 0px, and the actions rail painted 163px
     * over the neighbouring card. Asking about the container instead is the
     * whole fix, and it holds wherever the card is embedded next.
     */
    :host { display: block; container-type: inline-size; }
    /* Photo, particulars, actions. The third column is a fixed rail so the row
       ends in something rather than trailing off into white space. */
    .row { display: grid; grid-template-columns: 10rem minmax(0, 1fr) 11rem;
           gap: 1.1rem;
           border: 1px solid rgb(0 0 0 / 0.12); border-radius: 12px;
           background: #fff; padding: 0.9rem; align-items: stretch;
           transition: box-shadow 120ms ease, border-color 120ms ease; }
    .row:hover { border-color: rgb(var(--brand-rgb) / 0.35);
                 box-shadow: 0 8px 22px rgb(0 0 0 / 0.09); }

    /* align-self:start is load-bearing. The row stretches its items so the
       actions rail can carry a full-height rule, and a stretched item with an
       aspect-ratio derives its WIDTH from that height - which made the portrait
       wider than its own column and pushed it over the name. Pinned to the top,
       the height comes from the width instead, which is the way round intended. */
    .photo { position: relative; display: block; align-self: start; width: 100%;
             aspect-ratio: 4 / 5;
             border-radius: 9px; overflow: hidden; background: #f3f1ea; }
    .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .locked { position: absolute; inset: 0; display: flex; flex-direction: column;
              align-items: center; justify-content: center; gap: 0.4rem;
              font-size: 0.72rem; line-height: 1.35; text-align: center;
              color: rgb(0 0 0 / 0.5); padding: 0.6rem; }
    .icon { font-size: 1.5rem; }

    .body { min-width: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    .top { display: flex; align-items: flex-start; justify-content: space-between;
           gap: 0.75rem; }
    .who { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .name { font-size: 1.15rem; font-weight: 700; color: var(--brand-deep); text-decoration: none;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name:hover { text-decoration: underline; }
    /* The reference prints a profile id under the name, and families quote it
       to each other. It is derived from the record id, not a second identifier
       to keep in step. */
    .pid { font-size: 0.72rem; color: rgb(0 0 0 / 0.45); letter-spacing: 0.04em; }

    .facts { margin: 0; display: grid; gap: 0.4rem 1.2rem;
             grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .facts > div { min-width: 0; display: flex; flex-direction: column; gap: 0.05rem; }
    dt { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: rgb(0 0 0 / 0.45); }
    /* Wraps rather than truncating. Every value here is short, and the ones
       that are not - "Never married", a two-word city - were being cut to
       "Never marri…" by an ellipsis that saved nothing: the column is tall
       enough for a second line, and a particular a family cannot read is worse
       than an uneven row. */
    dd { margin: 0; font-size: 0.87rem; color: rgb(0 0 0 / 0.82);
         overflow-wrap: anywhere; }

    .side { display: flex; flex-direction: column; gap: 0.45rem;
            padding-left: 1rem; border-left: 1px solid rgb(0 0 0 / 0.08); }
    .guna { margin-bottom: 0.15rem; }
    .send { font-size: 0.85rem; font-weight: 700; }
    .save { font-size: 0.8rem; }
    .view { font-size: 0.8rem; color: var(--brand) !important; }
    .state { font-size: 0.72rem; font-weight: 700; color: rgb(0 0 0 / 0.5);
             text-transform: uppercase; letter-spacing: 0.04em;
             padding: 0.5rem 0; text-align: center; }
    .state.good { color: #1b5e20; }

    /* The rail folds under the particulars before the photo ever shrinks: the
       buttons can stack, but a thumbnail-sized portrait is no use to anyone. */
    /*
     * 34rem is where the three-column row stops fitting rather than a round
     * number: the photo, the rail, the gaps and the padding are 25rem of fixed
     * width between them, and the particulars need the rest to stay readable.
     */
    @container (max-width: 34rem) {
      .row { grid-template-columns: 9rem minmax(0, 1fr); }
      .side { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap;
              align-items: center; padding-left: 0; padding-top: 0.7rem;
              border-left: 0; border-top: 1px solid rgb(0 0 0 / 0.08); }
      .guna { margin-bottom: 0; }
    }
    @container (max-width: 24rem) {
      .row { grid-template-columns: 7rem minmax(0, 1fr); gap: 0.8rem; }
      .facts { grid-template-columns: 1fr; gap: 0.3rem; }
      .name { font-size: 1rem; }
    }
  `,
})
export class ProfileCard {
  readonly profile = input.required<ProfileCardDto>();

  readonly interested = output<string>();
  readonly shortlisted = output<string>();

  /**
  /** Shared with the member's own profile menu, so the two cannot disagree. */
  protected readonly displayId = computed(() => profileDisplayId(this.profile().id));

  /** 165 cm reads as 5'5" to most families looking at this. */
  protected height(): string {
    const cm = this.profile().heightCm;
    const inches = Math.round(cm / 2.54);
    return `${Math.floor(inches / 12)}'${inches % 12}" (${cm} cm)`;
  }

  protected label(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
