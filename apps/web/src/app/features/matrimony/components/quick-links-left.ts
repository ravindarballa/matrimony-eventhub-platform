import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The discovery dock, on the left.
 *
 * Deliberately the opposite edge from the account dock. The two are different
 * kinds of shortcut and putting them together would blur that: the right edge
 * is the member's own business - their dashboard, their lookups - while these
 * two are the product showing itself off. Somebody reaching for "who is on
 * here" and somebody reaching for "what is waiting for me" are in different
 * frames of mind, and one stack of six rows serves neither.
 *
 * Two entries, and it should stay small. A dock that grows into a second
 * navigation is a sign the real navigation is failing.
 */
@Component({
  selector: 'eh-quick-links-left',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="dock" [style.--offset]="offset()" [class.open]="open()">
      <!--
        The tab is the whole control when closed. Hovering opens it, and so does
        focus, so it is not a mouse-only feature; clicking pins it open for a
        touch screen, where there is no hover to rely on.
      -->
      <button
        type="button"
        class="tab"
        [attr.aria-expanded]="open()"
        aria-label="Discover"
        (click)="open.set(!open())"
      >
        <span class="glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M15.5 8.5l-2.1 5-5 2.1 2.1-5z" />
          </svg>
        </span>
        <span class="word">Discover</span>
      </button>

      <nav class="rows" aria-label="Discover">
        <a routerLink="/matrimony/wall" routerLinkActive="on" (click)="open.set(false)">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1.6" />
              <rect x="14" y="3" width="7" height="7" rx="1.6" />
              <rect x="3" y="14" width="7" height="7" rx="1.6" />
              <rect x="14" y="14" width="7" height="7" rx="1.6" />
            </svg>
          </span>
          <span class="txt">
            <strong>Members</strong>
            <small>Photos, ids and communities</small>
          </span>
        </a>

        <a routerLink="/matrimony/videos" routerLinkActive="on" (click)="open.set(false)">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
              <path class="fill" d="M10 9.2v5.6l4.8-2.8z" />
            </svg>
          </span>
          <span class="txt">
            <strong>Videos</strong>
            <small>Decoration, catering, photography</small>
          </span>
        </a>
      </nav>
    </div>
  `,
  styles: `
    :host { display: contents; }

    .dock { position: fixed; left: 0; z-index: 40;
            top: calc(var(--masthead-h, 6.5rem) + var(--offset, 0rem) + 4.5rem);
            display: flex; align-items: flex-start; }

    /* Written down the edge, so a closed dock costs a thumb's width of page
       rather than a column of it. */
    .tab { display: flex; align-items: center; gap: 0.45rem;
           padding: 0.8rem 0.45rem; border: 2px solid var(--gold);
           border-left: 0; border-radius: 0 999px 999px 0;
           background: var(--brand-deep); color: var(--gold);
           cursor: pointer; writing-mode: vertical-rl;
           box-shadow: 2px 2px 10px rgb(0 0 0 / 0.25);
           font: inherit; font-size: 0.78rem; font-weight: 700;
           letter-spacing: 0.06em; }
    .tab:hover { background: var(--brand); }
    .tab:focus-visible { outline: 3px solid var(--gold); outline-offset: 3px; }
    .glyph svg { width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor;
                 stroke-width: 2; stroke-linejoin: round; }

    /* Slid out rather than shown: the panel is always in the DOM so the links
       stay in the tab order and a keyboard can reach them, and the transform
       is what hides it. visibility stops it catching clicks while off-screen. */
    .rows { display: flex; flex-direction: column; gap: 0.2rem;
            width: 15rem; padding: 0.5rem; margin-left: 0.35rem;
            border: 1px solid var(--brand-line); border-radius: 0.7rem;
            background: #fff; box-shadow: 0 12px 30px rgb(0 0 0 / 0.18);
            transform: translateX(-110%); visibility: hidden; opacity: 0;
            transition: transform 160ms ease, opacity 160ms ease,
                        visibility 0s linear 160ms; }
    .dock:hover .rows, .dock:focus-within .rows, .dock.open .rows {
      transform: translateX(0); visibility: visible; opacity: 1;
      transition-delay: 0s; }

    .rows a { display: flex; align-items: center; gap: 0.6rem;
              padding: 0.5rem; border-radius: 0.5rem; color: inherit;
              text-decoration: none; }
    .rows a:hover, .rows a.on { background: var(--brand-tint); }
    .rows a:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

    .ico { display: grid; place-items: center; width: 1.7rem; height: 1.7rem;
           color: var(--brand); flex: 0 0 auto; }
    .ico svg { width: 1.15rem; height: 1.15rem; fill: none; stroke: currentColor;
               stroke-width: 1.9; }
    .ico .fill { fill: currentColor; stroke: none; }

    .txt { display: flex; flex-direction: column; }
    .txt strong { font-size: 0.9rem; font-weight: 600; }
    .txt small { font-size: 0.74rem; color: rgb(0 0 0 / 0.58); }

    @media (prefers-reduced-motion: reduce) {
      .rows { transition: none; }
    }

    /* On a phone the flyout would cover the page it is sitting on, so the dock
       stands down entirely - the same two destinations are in the main nav. */
    @media (max-width: 700px) {
      .dock { display: none; }
    }
  `,
})
export class MatrimonyQuickLinksLeft {
  /** Matches the right-hand dock, so the two hang level under the banner. */
  readonly offset = input('0rem');

  protected readonly open = signal(false);
}
