import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { profileDisplayId, type ProfileCardDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';

/**
 * The members wall: the whole population, moving.
 *
 * Three rows of portraits drifting in alternating directions, each carrying the
 * quotable id and the community underneath. It is the one screen that answers
 * "are there actually people here?" without asking anyone to run a search
 * first - which is the question every visitor to a matrimony site has and the
 * faceted search cannot answer, because an empty filter combination looks
 * identical to an empty site.
 *
 * Every face on it is a profile the viewer is allowed to see: the rows are the
 * ordinary search, so the opposite-gender rule, the blocks and the photo
 * privacy settings all hold exactly as they do everywhere else. A wall that
 * showed more than the search would be a privacy hole with a nice animation.
 */
@Component({
  selector: 'eh-matrimony-wall-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="wrap">
      <header class="head">
        <h1>Members</h1>
        <p class="sub">
          @if (rows().length) {
            {{ total() }} profiles you can write to today. Every photo here is a
            published profile.
          } @else {
            Bringing the wall up…
          }
        </p>
      </header>

      @if (data.error()) {
        <p class="err" role="alert">
          The wall could not load. Your profile has to be published before you
          can browse members.
          <a routerLink="/matrimony/profile/edit">Finish your profile</a>
        </p>
      } @else {
        <!--
          Each row is the same list twice over, end to end, and the track slides
          by exactly half its width before snapping back. That is what makes the
          loop seamless: at the moment it resets, the second copy is sitting
          precisely where the first one started, so there is no visible jump.
        -->
        <section class="wall" aria-label="Members">
          @for (row of rows(); track $index) {
            <div class="row" [class.rev]="$index % 2 === 1">
              <div class="track" [style.--n]="row.length">
                @for (card of row.concat(row); track $index) {
                  <a
                    class="tile"
                    [routerLink]="['/matrimony/profile', card.id]"
                    [attr.aria-label]="card.displayName + ', ' + card.community"
                  >
                    @if (card.photoUrl) {
                      <img [src]="card.photoUrl" [alt]="card.displayName" loading="lazy" />
                    } @else {
                      <span class="ph" aria-hidden="true">
                        {{ card.displayName.charAt(0) }}
                      </span>
                    }

                    <span class="meta">
                      <span class="id">{{ displayId(card.id) }}</span>
                      <span class="comm">{{ card.community }}</span>
                    </span>
                  </a>
                }
              </div>
            </div>
          }
        </section>
      }

      <footer class="foot">
        <a routerLink="/matrimony/search" class="cta">Search with filters</a>
      </footer>
    </main>
  `,
  styles: `
    .wrap { padding: 1.5rem 0 3rem; display: flex; flex-direction: column;
            gap: 1.25rem; }
    .head { padding: 0 clamp(1rem, 4vw, 2.5rem); }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.3rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.92rem; }
    .err { margin: 0 clamp(1rem, 4vw, 2.5rem); padding: 0.9rem 1rem;
           background: #fdecea; color: #a32020; border-radius: 0.5rem; }

    /* The dark band the portraits sit on, as the reference has it: the faces
       carry the colour, so the ground behind them must not compete. */
    .wall { background: #0d1b1a; padding: 1.4rem 0; overflow: hidden;
            display: flex; flex-direction: column; gap: 0.9rem; }

    .row { overflow: hidden; }
    .track { display: flex; gap: 0.9rem; width: max-content;
             animation: drift calc(var(--n) * 2.6s) linear infinite; }
    .row.rev .track { animation-direction: reverse; }

    /* Pausing on hover is not a nicety - the tiles are links, and a target
       that slides out from under the pointer cannot be clicked reliably. */
    .wall:hover .track, .track:focus-within { animation-play-state: paused; }

    @keyframes drift {
      from { transform: translateX(0); }
      to   { transform: translateX(-50%); }
    }

    .tile { position: relative; flex: 0 0 auto; width: 9.5rem; height: 11rem;
            border-radius: 0.9rem; overflow: hidden; text-decoration: none;
            background: #1c2b2a; display: block; }
    .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ph { display: grid; place-items: center; width: 100%; height: 100%;
          font-size: 2.4rem; font-weight: 700; color: rgb(255 255 255 / 0.5); }

    .tile:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }

    /* The id and community ride on the photo rather than under it: the row is
       a fixed height, and a caption below would either crop the face or make
       every tile taller for the sake of two short lines. */
    .meta { position: absolute; inset: auto 0 0; padding: 1.6rem 0.55rem 0.5rem;
            display: flex; flex-direction: column; gap: 0.1rem;
            background: linear-gradient(transparent, rgb(0 0 0 / 0.82)); }
    .id { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em;
          color: var(--gold); }
    .comm { font-size: 0.78rem; color: #fff; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }

    .foot { padding: 0 clamp(1rem, 4vw, 2.5rem); }
    .cta { display: inline-block; padding: 0.6rem 1.1rem; border-radius: 999px;
           background: var(--brand); color: #fff; text-decoration: none;
           font-weight: 600; font-size: 0.9rem; }

    /* A page whose whole subject is motion still has to stand still for
       somebody who asked for that; the wall becomes an ordinary scrolling row. */
    @media (prefers-reduced-motion: reduce) {
      .track { animation: none; }
      .row { overflow-x: auto; }
    }

    @media (max-width: 600px) {
      .tile { width: 7.5rem; height: 9rem; }
    }
  `,
})
export class MatrimonyWallPage {
  private readonly api = inject(MatrimonyApi);

  /** One wide page of cards, which is as much as the wall can show at once. */
  protected readonly data = httpResource<ProfileCardDto[]>(
    () => this.api.searchUrl({ limit: 50, sort: 'recent' }),
    { parse: unwrap<ProfileCardDto[]>, defaultValue: [] },
  );

  protected readonly total = computed(() => this.data.value().length);

  /**
   * Split into three rows, dealt round-robin rather than in blocks.
   *
   * Dealing in blocks would put the fifty most recent profiles on the top row
   * and the oldest on the bottom, so one row would visibly carry the better
   * photos. Round-robin mixes them.
   */
  protected readonly rows = computed<ProfileCardDto[][]>(() => {
    const all = this.data.value();
    if (all.length === 0) return [];

    const rows: ProfileCardDto[][] = [[], [], []];
    all.forEach((card, i) => rows[i % 3]!.push(card));

    // A row with one or two tiles cannot fill the width, and the loop would be
    // a single face sliding past. Those rows are dropped rather than shown.
    return rows.filter((r) => r.length >= 3);
  });

  protected displayId(id: string): string {
    return profileDisplayId(id);
  }
}
