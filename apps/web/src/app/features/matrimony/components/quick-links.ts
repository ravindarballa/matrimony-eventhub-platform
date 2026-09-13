import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { MatrimonyDashboardDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import { MatrimonySearchStore } from '../data/search.store';

/**
 * The floating quick links: one wedding ring on the edge of every screen.
 *
 * It gathers the two shortcuts that were previously scattered - the dashboard
 * tag hanging off the masthead and the profile lookup that briefly sat in the
 * bar - into a single control that stays closed until it is wanted.
 *
 * They belong together because they are the same kind of thing: neither is the
 * page, both are ways off it. Spread across the chrome they each took a
 * permanent seat in a bar already carrying seven nav links, and the lookup in
 * particular made the masthead read as a search bar, which is not what this
 * product's banner is for.
 *
 * The plan hourglass is deliberately not here. It belongs beside the account
 * controls it shares a deadline with, and it is drawn for the coloured bar it
 * sits on - recolouring it for a white panel would be two sets of styles for
 * one small thing.
 *
 * The rings rather than a magnifier or a chevron. This is a wedding platform,
 * the control is the one ornament on the page, and a generic glyph in the
 * corner is indistinguishable from a support widget - which is exactly what
 * people learn to ignore.
 */
@Component({
  selector: 'eh-quick-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <!--
      Closing on focusout as well as on the backdrop: the panel holds a text
      field, so it can be left by keyboard without the pointer ever going near
      the page behind it.
    -->
    <div
      class="dock"
      [style.--offset]="offset()"
      (focusout)="closeSoon()"
      (focusin)="cancelClose()"
    >
      @if (open()) {
        <!--
          Transparent, and only present while open. It is what makes a click
          anywhere else close the panel without every screen behind it having
          to know this control exists.
        -->
        <button
          type="button"
          class="scrim"
          tabindex="-1"
          aria-hidden="true"
          (click)="close()"
        ></button>
      }

      <button
        type="button"
        class="fab"
        [class.on]="open()"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="fabLabel()"
        [title]="fabLabel()"
        (click)="toggle()"
      >
        <!--
          Two rings, interlocked. Drawn rather than loaded: it is nine lines of
          markup against a webfont request for one glyph, and it inherits the
          bar's colours instead of arriving in somebody else's.
        -->
        <svg class="rings" viewBox="0 0 40 30" aria-hidden="true" focusable="false">
          <circle class="r1" cx="15" cy="16" r="9" />
          <circle class="r2" cx="25" cy="16" r="9" />
          <path class="gem" d="M15 7 l2.6 3.2 h-5.2 Z" />
        </svg>

        @if (waiting(); as n) {
          <span class="count">{{ n > 99 ? '99+' : n }}</span>
        }
      </button>

      @if (open()) {
        <div class="panel" role="group" aria-label="Quick links">
          <!--
            The lookup first: it is the only thing here somebody arrives
            already holding a value for, having been read an id down the phone.
          -->
          <label class="find">
            <span class="lbl">Find a profile</span>
            <input
              #field
              type="search"
              placeholder="Name or ID, e.g. EHCD97D7D"
              [value]="term()"
              (input)="term.set($any($event.target).value)"
              (keydown.enter)="submit()"
              (keydown.escape)="close()"
            />
          </label>

          <a class="row" routerLink="/matrimony/search" (click)="close()">
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
            </span>
            <span class="txt">Search</span>
          </a>

          <a class="row" routerLink="/matrimony/dashboard" (click)="close()">
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="8" rx="1.5" />
                <rect x="14" y="3" width="7" height="5" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="11" width="7" height="10" rx="1.5" />
              </svg>
            </span>
            <span class="txt">Dashboard</span>
            @if (waiting(); as n) {
              <span class="pill">{{ n > 99 ? '99+' : n }}</span>
            }
          </a>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: contents; }

    /*
     * Hung from the bottom edge of the masthead on the right, where the
     * dashboard tag used to hang - fixed rather than sticky so it survives the
     * long scrolls on search, and offset by the shell when a profile banner is
     * sitting directly under the bar.
     */
    .dock { position: fixed; right: 0; z-index: 40;
            top: calc(var(--masthead-h, 6.5rem) + var(--offset, 0rem));
            display: flex; flex-direction: column; align-items: flex-end;
            gap: 0.5rem; }

    .scrim { position: fixed; inset: 0; z-index: -1;
             border: 0; padding: 0; background: transparent; cursor: default; }

    .fab { position: relative; display: grid; place-items: center;
           width: 3.1rem; height: 3.1rem; padding: 0;
           border: 2px solid var(--gold); border-top-right-radius: 0;
           border-bottom-right-radius: 0; border-right: 0;
           border-radius: 999px 0 0 999px;
           background: var(--brand-deep); color: var(--gold);
           cursor: pointer; box-shadow: -2px 2px 10px rgb(0 0 0 / 0.25);
           transition: background-color 140ms ease, width 140ms ease; }
    .fab:hover, .fab.on { background: var(--brand); }
    .fab:focus-visible { outline: 3px solid var(--gold); outline-offset: 3px; }

    .rings { width: 1.9rem; height: 1.45rem; fill: none;
             stroke: currentColor; stroke-width: 2.4; overflow: visible; }
    .gem { fill: currentColor; stroke: none; }

    /* The one moving thing on the page, and it moves slowly. The rings turn
       about a quarter turn and settle - enough to catch an eye passing over
       it, not enough to pull one back that has moved on. */
    .r1 { animation: tilt 6s ease-in-out infinite; transform-origin: 15px 16px; }
    .r2 { animation: tilt 6s ease-in-out infinite reverse; transform-origin: 25px 16px; }
    .fab.on .r1, .fab.on .r2 { animation: none; }

    @keyframes tilt {
      0%, 62%, 100% { transform: rotate(0deg); }
      74% { transform: rotate(-11deg); }
      86% { transform: rotate(6deg); }
    }

    .count { position: absolute; top: -3px; left: -3px; min-width: 1.15rem;
             padding: 0 0.25rem; border-radius: 999px; background: var(--gold);
             color: var(--brand-deep); font-size: 0.68rem; font-weight: 800;
             line-height: 1.15rem; text-align: center; }

    .panel { width: min(17rem, calc(100vw - 1.5rem));
             margin-right: 0.55rem; padding: 0.75rem;
             border: 1px solid var(--brand-line); border-radius: 0.7rem;
             background: #fff;
             box-shadow: 0 12px 30px rgb(0 0 0 / 0.18);
             display: flex; flex-direction: column; gap: 0.35rem; }

    .find { display: flex; flex-direction: column; gap: 0.25rem;
            margin-bottom: 0.15rem; }
    .lbl { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
           text-transform: uppercase; opacity: 0.6; }
    .find input { width: 100%; box-sizing: border-box; font: inherit;
                  font-size: 0.86rem; padding: 0.45rem 0.6rem;
                  border: 1px solid var(--brand-line); border-radius: 0.45rem;
                  background: #fff; color: inherit; }
    .find input:focus { outline: none; border-color: var(--brand);
                        box-shadow: 0 0 0 3px rgb(var(--brand-rgb) / 0.14); }
    .find input::-webkit-search-cancel-button { display: none; }

    .row { display: flex; align-items: center; gap: 0.6rem;
           padding: 0.45rem 0.5rem; border-radius: 0.45rem;
           color: inherit; text-decoration: none; font-size: 0.9rem; }
    .row:hover { background: var(--brand-tint); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

    .ico { display: grid; place-items: center; width: 1.5rem; height: 1.5rem;
           color: var(--brand); }
    .ico svg { width: 1.05rem; height: 1.05rem; fill: none;
               stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .txt { flex: 1; }

    .pill { min-width: 1.2rem; padding: 0 0.3rem; border-radius: 999px;
            background: var(--brand); color: #fff; font-size: 0.7rem;
            font-weight: 700; line-height: 1.2rem; text-align: center; }

    @media (prefers-reduced-motion: reduce) {
      .r1, .r2 { animation: none; }
      .fab { transition: none; }
    }
  `,
})
export class MatrimonyQuickLinks {
  /**
   * How far below the masthead to hang.
   *
   * The shell puts a profile nudge directly under the bar on most screens, and
   * it is full-bleed - so a control pinned to the masthead lands on top of it.
   * The shell is the only thing that knows whether that banner is there, so it
   * passes the distance rather than this component guessing.
   */
  readonly offset = input('0rem');

  private readonly api = inject(MatrimonyApi);
  private readonly router = inject(Router);
  private readonly store = inject(MatrimonySearchStore);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly open = signal(false);
  protected readonly term = signal('');

  private closing: ReturnType<typeof setTimeout> | null = null;

  private readonly summary = httpResource<MatrimonyDashboardDto>(
    () => this.api.dashboardUrl,
    { parse: unwrap<MatrimonyDashboardDto> },
  );

  /** Null rather than 0, so the badge is absent instead of showing a zero. */
  protected readonly waiting = computed<number | null>(() => {
    const s = this.summary.value();
    if (!s) return null;
    const n = s.interests.received + s.chat.unread;
    return n > 0 ? n : null;
  });

  protected readonly fabLabel = computed(() => {
    if (this.open()) return 'Close quick links';
    const n = this.waiting();
    return n ? `Quick links — ${n} waiting for you` : 'Quick links';
  });

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    // After the panel exists. Opening a menu whose first control is a text
    // field and leaving the caret elsewhere wastes the click that opened it.
    queueMicrotask(() => this.field()?.nativeElement.focus());
  }

  protected close(): void {
    this.cancelClose();
    this.open.set(false);
    this.term.set('');
  }

  /**
   * Focus moving inside the panel leaves it open; focus leaving closes it.
   *
   * focusout fires before focusin on the element being moved to, so the close
   * is deferred by a tick and cancelled if the focus landed somewhere in here
   * after all - without that, tabbing from the field to Dashboard would shut
   * the panel on the way.
   */
  protected closeSoon(): void {
    this.closing = setTimeout(() => this.open.set(false), 0);
  }

  protected cancelClose(): void {
    if (this.closing) clearTimeout(this.closing);
    this.closing = null;
  }

  /**
   * Hands the term to the search store and shows the results.
   *
   * It goes through the same store the filter rail writes to, so a quick
   * lookup is an ordinary search carrying one more filter - which means it
   * survives back-navigation, clears with the rest, and is counted by the
   * "clear N filters" affordance like every other narrowing.
   */
  protected submit(): void {
    const term = this.term().trim();
    if (!term) return;
    this.store.setFilter('q', term);
    void this.router.navigateByUrl('/matrimony/search');
    this.close();
  }
}
