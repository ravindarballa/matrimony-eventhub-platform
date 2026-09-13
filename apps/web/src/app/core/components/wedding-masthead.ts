import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  type OnDestroy,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import {
  ALL_CATEGORIES,
  CATEGORY_GROUPS,
  CATEGORY_META,
  MOST_BOOKED,
  RELIGIONS,
  VendorCategory,
  categorySlug,
  type VendorSearchResult,
} from '@eventhub/contracts';

import { AuthStore } from '../../features/auth/data/auth.store';
import { landingRouteFor } from '../guards/auth.guards';
import { CITIES } from '../../features/browse/data/cities';

/**
 * The masthead for the public wedding-marketplace pages.
 *
 * Two strips, as the reference design carries them: a thin deep-magenta utility
 * line, then the brand bar. It lives here rather than inside one page because
 * the enquiry page, the browse pages and the landing page are one product to a
 * visitor, and three different headers - or, as it was, one header and two
 * pages with none at all - read as three different sites.
 *
 * Extracting it also keeps the pages inside Angular's per-component style
 * budget. The enquiry page had reached 7.88 kB of a 8 kB error ceiling with the
 * masthead's CSS inlined, which is a build failure waiting for the next rule
 * somebody adds.
 *
 * The nav deliberately lists only routes that exist. Links to pages we have not
 * built would be the fastest way to lose the trust the rest of the page is
 * working to earn.
 */
@Component({
  selector: 'eh-wedding-masthead',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule],
  template: `
    <!--
      Both strips are one hover surface.
      The panels hang below the whole masthead, so travelling from a link down to
      its panel crosses a band that belongs to neither. With the close listener
      on the links alone that band shut the menu before the pointer arrived,
      which made the submenus unreachable. The wrapper contains the links and the
      panels, so crossing the gap stays inside the listener and only leaving the
      whole assembly closes it.
    -->
    <div class="masthead" (mouseleave)="scheduleClose()" (mouseenter)="cancelClose()">
      <!--
        The thin strip always advertises the OTHER half of the product, with a
        line of copy leading into it. A visitor deep in the matrimony search is
        the best prospect there is for the wedding marketplace, and the reverse
        holds too - but only one of the two is ever what they came for, so the
        other belongs here rather than competing in the brand bar.
      -->
      <header class="utility">
        <nav class="utilnav">
          <span class="tag">{{ crossSell().lead }}</span>
          <!--
            A plain link, deliberately. This is the doorway to the other half of
            the product, not a place to browse it: somebody who wants a caterer
            is on the wedding side already, and hanging a full category panel off
            a cross-sell drops it over the page every time the pointer passes
            through on its way to the corner. Hovering it dismisses whatever is
            open, because reaching for it means leaving the menus.
          -->
          <a
            [routerLink]="crossSell().link"
            (mouseenter)="scheduleClose()"
          >{{ crossSell().label }}</a>
        </nav>
      </header>

    <nav class="brandbar">
      <a class="brand" routerLink="/">
        <span class="mark">EH</span>
        <span class="wordmark">Matrimony <strong>EventHub</strong></span>
      </a>

      <!--
        The brand bar carries whichever half the visitor is actually in, with its
        own tabs. On the wedding side that means Venues alongside the category
        menu; on the matrimony side, the match search. The matrimony link is
        plain /matrimony/search - signed out, the route guard sends the visitor
        to sign in and returns them here; signed in, they land on the search.
        Nothing here needs to know which, because the guard already does.
      -->
      <!--
        The menu button for narrow screens. Below 60rem the links cannot fit
        beside the brand and the account cluster, and the old rule simply hid
        them - which left a signed-in member on a phone with no route to Search,
        Interests or Chat at all. Hiding navigation is only acceptable when
        something gives it back.
      -->
      <button
        type="button"
        class="burger"
        [class.on]="menuOpen()"
        [attr.aria-expanded]="menuOpen()"
        aria-label="Menu"
        (click)="toggleMenu()"
      >
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>

      <div class="navlinks" [class.open]="menuOpen()">
        <!--
          A portal can project its own links here - the matrimony shell needs
          Search, Interests, Shortlist and the rest, which no amount of context
          switching in this component could guess. When nothing is projected the
          public default below renders instead.
        -->
        <ng-content select="[bar-nav]">
        @if (context() === 'wedding') {
          <div class="item">
            <a
              routerLink="/vendors"
              [class.on]="open() === 'vendors'"
              (mouseenter)="openPanel('vendors')"
              (focus)="openPanel('vendors')"
            >Event planning</a>
          </div>

          <div class="item">
            <a
              [routerLink]="['/vendors', venueSlug]"
              [class.on]="open() === 'venues'"
              (mouseenter)="openPanel('venues')"
              (focus)="openPanel('venues')"
            >Venues</a>
          </div>
        } @else {
          <div class="item">
            <a
              routerLink="/matrimony/search"
              [class.on]="open() === 'matrimony'"
              (mouseenter)="openPanel('matrimony')"
              (focus)="openPanel('matrimony')"
            >Matrimony</a>
          </div>
        }
        </ng-content>
      </div>

      <!-- Same again for the right-hand side: a portal projects its bell and
           sign-out, the public pages fall back to sign in and register. -->
      <ng-content select="[bar-end]">
        @if (store.isAuthenticated()) {
          <!--
            Signed in, the bar carries an initialled avatar rather than the
            "Go to my account" button it used to. The button was removed on
            purpose, but removing it left a signed-in visitor on the public
            pages with no route back to their own portal at all. This is the
            same affordance the matrimony bar uses, in its smallest form.
          -->
          <a
            class="avatar"
            [routerLink]="myPortal()"
            [attr.aria-label]="'Go to my account, ' + store.displayName()"
            [title]="store.displayName()"
          >{{ initials() }}</a>
        } @else {
          <a class="signin" routerLink="/auth/login">Sign in</a>
          <a mat-flat-button class="login" routerLink="/auth/register">Register free</a>
        }
      </ng-content>
    </nav>

    <!--
      The panels live outside both strips so they can hang below the whole
      masthead and span its full width, wherever their trigger sits.
    -->
    @if (open() === 'venues') {
            <div class="mega venues" (mouseenter)="cancelClose()">
              <div class="col">
                <h3>By city</h3>
                @for (c of cities; track c) {
                  <a
                    [routerLink]="['/vendors', venueSlug]"
                    [queryParams]="{ city: c }"
                    (click)="open.set(null)"
                  >{{ c }}</a>
                }
              </div>

              <div class="col wide">
                <h3>Top rated venues</h3>
                @if (venues.value().length) {
                  <div class="tiles">
                    @for (v of venues.value(); track v.id) {
                      <a
                        class="tile"
                        [routerLink]="['/vendors', venueSlug, v.id]"
                        (click)="open.set(null)"
                      >
                        <span class="shot">
                          @if (coverOf(v); as url) {
                            <img [src]="url" alt="" loading="lazy" />
                          }
                        </span>
                        <span class="tname">{{ v.businessName }}</span>
                        <span class="tcity">{{ v.city }}</span>
                      </a>
                    }
                  </div>
                } @else {
                  <p class="muted">Loading venues…</p>
                }
                <a class="viewall" routerLink="/vendors" (click)="open.set(null)">
                  View all categories
                </a>
              </div>
            </div>
    }

    @if (open() === 'vendors') {
            <div class="mega vendors" (mouseenter)="cancelClose()">
              <!--
                The five a family books first, promoted out of their bands.
                Everything is still one hover and one click away in the columns
                that follow, but the common path no longer requires reading the
                whole table to find it - which is what tabs in the bar were
                being asked to solve, without spending the bar to do it.
              -->
              <div class="col">
                <h3>Most booked</h3>
                @for (c of mostBooked; track c) {
                  <a
                    class="viewall"
                    [routerLink]="['/vendors', slug(c)]"
                    (click)="open.set(null)"
                  >{{ meta(c).plural }}</a>
                }
              </div>

              @for (band of groups; track band.group) {
                <div class="col">
                  <h3>{{ band.group }}</h3>
                  @for (c of band.categories; track c) {
                    <a
                      [routerLink]="['/vendors', slug(c)]"
                      (click)="open.set(null)"
                    >{{ meta(c).plural }}</a>
                  }
                </div>
              }
              <div class="col">
                <a class="viewall" routerLink="/vendors" (click)="open.set(null)">
                  View all {{ totalCategories }} categories
                </a>
                <a class="viewall" routerLink="/enquire" (click)="open.set(null)">
                  Get quotes from five at once
                </a>
              </div>
            </div>
    }

    <!--
      Every link here drives the matrimony search's real query parameters, so
      "Telugu" is a search that runs rather than a landing page somebody still
      has to build. Searching needs an account and a profile, so a signed-out
      visitor lands on sign-in with the search waiting behind it - the honest
      behaviour of a gated product, not a dead end.
    -->
    @if (open() === 'matrimony') {
            <div class="mega vendors" (mouseenter)="cancelClose()">
              <div class="col">
                <h3>By mother tongue</h3>
                @for (t of tongues; track t) {
                  <a
                    routerLink="/matrimony/search"
                    [queryParams]="{ motherTongue: t }"
                    (click)="open.set(null)"
                  >{{ t }} matches</a>
                }
              </div>

              <div class="col">
                <h3>By religion</h3>
                @for (r of religions; track r) {
                  <a
                    routerLink="/matrimony/search"
                    [queryParams]="{ religion: r }"
                    (click)="open.set(null)"
                  >{{ r }} matches</a>
                }
              </div>

              <div class="col">
                <h3>By city</h3>
                @for (c of cities; track c) {
                  <a
                    routerLink="/matrimony/search"
                    [queryParams]="{ city: c }"
                    (click)="open.set(null)"
                  >Brides &amp; grooms in {{ c }}</a>
                }
              </div>

              <div class="col">
                <h3>Getting started</h3>
                <a routerLink="/auth/register/matrimony" (click)="open.set(null)">
                  Create a profile
                </a>
                <a routerLink="/matrimony/search" (click)="open.set(null)">
                  Search all profiles
                </a>
                <a class="viewall" routerLink="/matrimony/plans" (click)="open.set(null)">
                  See the plans
                </a>
              </div>
            </div>
    }
    </div>
  `,
  styles: `
    :host { display: block; --deep: var(--brand-deep); --pink: var(--brand); }

    /* The wrapper is the positioned ancestor the panels anchor to, so they hang
       below BOTH strips however deep the masthead is. It carries the sticky, so
       a stuck masthead keeps its panels attached. */
    .masthead { position: sticky; top: 0; z-index: 20; }

    /* The cross-sell sits in the right corner. It is an aside, not the page's
       subject, and the left edge is where the eye starts - giving that away to
       the half the visitor did not come for buries the half they did. */
    .utility { display: flex; align-items: stretch; justify-content: flex-end;
               gap: 1rem; flex-wrap: wrap; background: var(--deep); color: #fff;
               padding: 0 clamp(1rem, 4vw, 2.5rem); font-size: 0.86rem; }
    .tag { opacity: 0.92; align-self: center; padding: 0.45rem 0; }
    .utilnav { display: flex; align-items: center; gap: 0.85rem; }
    .utilnav .item { display: flex; align-items: center; }

    /* A button at rest, not on approach. The strip is the only route to the
       other half of the product, and a plain-text cross-sell on a coloured bar
       is read as a label rather than a destination - it has to look pressable
       before the pointer is anywhere near it to be found at all.

       Hover then has to signal something the resting state does not, so it
       warms the fill rather than introducing the pill. Geometry is fixed
       across every state: only paint changes, so the target never moves
       between deciding to click and clicking. */
    .utilnav a { color: var(--deep); text-decoration: none;
                 display: flex; align-items: center; padding: 0.3rem 0.9rem;
                 margin: 0.28rem 0; border: 1px solid #fff;
                 border-radius: 999px; background: #fff; font-weight: 600;
                 white-space: nowrap; transition: background-color 120ms ease,
                 color 120ms ease, border-color 120ms ease; }
    .utilnav a:hover, .utilnav a:focus-visible, .utilnav a.on {
      background: rgb(255 255 255 / 0.86); border-color: rgb(255 255 255 / 0.86); }
    .utilnav a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      .utilnav a { transition: none; }
    }

    .brandbar { display: flex; align-items: center;
                gap: clamp(1rem, 3vw, 2.5rem); background: var(--pink); color: #fff;
                padding: 0.6rem clamp(1rem, 4vw, 2.5rem);
                box-shadow: 0 1px 6px rgb(0 0 0 / 0.18); }
    .brand { display: flex; align-items: center; gap: 0.55rem; color: inherit;
             text-decoration: none; }
    .mark { display: grid; place-items: center; width: 2rem; height: 2rem;
            border-radius: 7px; background: #fff; color: var(--pink);
            font-weight: 800; font-size: 0.85rem; }
    .wordmark { font-size: 1.05rem; }
    .wordmark strong { font-weight: 800; }
    .navlinks { display: flex; align-items: center;
                gap: clamp(0.9rem, 2.5vw, 1.9rem); margin-right: auto; }
    /* The links fill the bar vertically. A link only as tall as its text leaves
       a dead strip above and below it inside the bar, and a pointer drifting
       into that strip on its way to the panel reads as "left the menu". */
    .navlinks { align-self: stretch; }
    .item { display: flex; align-items: stretch; }
    .navlinks > a, .item > a { color: rgb(255 255 255 / 0.88); text-decoration: none;
                  font-size: 0.95rem; display: flex; align-items: center;
                  padding: 0.75rem 0.25rem;
                  border-bottom: 2px solid transparent; white-space: nowrap; }
    .navlinks > a:hover, .navlinks > a.on,
    .item > a:hover, .item > a.on { color: #fff; border-bottom-color: #fff; }

    /* -------------------------------------------------------- mega panels */

    /* The panel hangs off the bar, not the link, so it can run the full width
       the way the reference's does. The item keeps the hover alive because the
       panel is inside it. */
    .item { position: static; }
    .mega { position: absolute; left: 0; right: 0; top: 100%; z-index: 30;
            display: grid; gap: clamp(1rem, 3vw, 2.5rem);
            padding: clamp(1.2rem, 3vw, 2rem) clamp(1rem, 4vw, 2.5rem);
            background: #fff; color: rgb(0 0 0 / 0.8);
            box-shadow: 0 18px 40px rgb(0 0 0 / 0.22);
            border-top: 1px solid rgb(0 0 0 / 0.06); }
    .mega.venues { grid-template-columns: 14rem 1fr; }
    /* Five fixed columns rather than auto-fit. Nine short lists auto-fitted
       came out as seven on one row and two on the next, which reads as a
       mistake; five and four is a shape. align-items:start stops a column with
       one entry stretching to the height of one with five. */
    .mega.vendors { grid-template-columns: repeat(5, minmax(0, 1fr));
                    align-items: start; row-gap: 1.4rem; }

    @media (max-width: 1100px) {
      .mega.vendors { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 780px) {
      .mega.vendors { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    .col { display: flex; flex-direction: column; gap: 0.38rem; min-width: 0; }
    .col h3 { margin: 0 0 0.35rem; font-size: 0.95rem; font-weight: 700;
              color: var(--pink); }
    .mega a { color: rgb(0 0 0 / 0.72); text-decoration: none; font-size: 0.9rem;
              border-bottom: 0; white-space: normal; padding: 0; }
    .mega a:hover { color: var(--pink); text-decoration: underline; }
    .viewall { font-weight: 700; color: rgb(0 0 0 / 0.85) !important; }
    .muted { margin: 0; font-size: 0.85rem; color: rgb(0 0 0 / 0.45); }

    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
             gap: 0.8rem; margin-bottom: 0.8rem; }
    .tile { display: flex; flex-direction: column; gap: 0.2rem; }
    .shot { display: block; aspect-ratio: 4 / 3; border-radius: 8px; overflow: hidden;
            background: #f0ecef; }
    .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tname { font-size: 0.85rem; font-weight: 600; color: rgb(0 0 0 / 0.85);
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tcity { font-size: 0.76rem; color: rgb(0 0 0 / 0.5); }
    .avatar { display: grid; place-items: center; width: 2.2rem; height: 2.2rem;
              border-radius: 50%; text-decoration: none; color: #fff;
              font-size: 0.78rem; font-weight: 700;
              background: rgb(255 255 255 / 0.16);
              border: 2px solid rgb(255 255 255 / 0.55); }
    .avatar:hover, .avatar:focus-visible { border-color: #fff; }
    .signin { color: rgb(255 255 255 / 0.92); text-decoration: none;
              font-size: 0.95rem; white-space: nowrap; }
    .signin:hover { color: #fff; text-decoration: underline; }
    .login { background: #fff !important; color: var(--pink) !important;
             font-weight: 700; border-radius: 999px !important; }

    /* Hidden on a wide bar: the links are already on show. */
    .burger { display: none; flex-direction: column; justify-content: center;
              gap: 4px; width: 2.2rem; height: 2.2rem; padding: 0;
              border: 1px solid rgb(255 255 255 / 0.45); border-radius: 7px;
              background: none; cursor: pointer; }
    .burger span { display: block; height: 2px; width: 1.1rem; margin: 0 auto;
                   background: #fff; border-radius: 2px;
                   transition: transform 160ms ease, opacity 160ms ease; }
    .burger.on span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
    .burger.on span:nth-child(2) { opacity: 0; }
    .burger.on span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

    /*
     * 60rem is where the bar runs out of room, measured rather than picked: at
     * 768px the matrimony nav plus the account cluster overflowed the viewport
     * by 69px and the whole page scrolled sideways. Below this the links move
     * into a panel under the bar instead of being dropped.
     */
    /*
     * On a narrow bar the wordmark goes and the EH mark stays. Six controls,
     * a two-line wordmark and a two-line "Sign out" is what 390px looked like
     * otherwise - the mark alone still identifies the product, and the room it
     * gives back is what keeps the buttons on one line each.
     */
    @media (max-width: 26rem) {
      .wordmark { display: none; }
    }

    @media (max-width: 60rem) {
      .burger { display: flex; }
      .tag { display: none; }

      .navlinks { display: none; }
      .navlinks.open { display: block; position: absolute; left: 0; right: 0;
                       top: 100%; z-index: 25; padding: 0.4rem 1rem 0.8rem;
                       background: var(--pink);
                       box-shadow: 0 12px 24px rgb(0 0 0 / 0.25); }

      /* Hover panels are a pointer affordance; there is no pointer here, and a
         full-width category table inside a dropdown is unusable anyway. */
      .mega { display: none; }
    }
  `,
})
export class WeddingMasthead implements OnDestroy {
  /** Which nav item to underline, when the page is one of them. */
  /**
   * Which half of the product this page belongs to.
   *
   * It decides both bars: the one the visitor is in gets the brand bar and its
   * tabs, the other gets the thin strip above with a line of copy leading into
   * it. `home` is the case where neither has been chosen yet, so matrimony
   * leads - it is what the name over the door promises - and the wedding side
   * is offered above it.
   */
  readonly context = input<
    'home' | 'matrimony' | 'wedding' | 'console'
  >('home');

  /**
   * What the thin strip above advertises.
   *
   * The consumer contexts each point at the half the visitor is not already in.
   * A console - the vendor desk, the admin desk - gets neither: offering a
   * wedding photographer a matrimony search is noise on a screen somebody is
   * working in, so the strip carries the way back to the public site instead,
   * which is the one link those screens genuinely lack.
   */
  protected readonly crossSell = computed(() => {
    switch (this.context()) {
      case 'wedding':
        return {
          lead: 'Are you looking for the right match?',
          label: 'Find a match',
          link: '/matrimony/search',
        };
      case 'console':
        return {
          lead: 'Want to see what members see?',
          label: 'View the public site',
          link: '/',
        };
      default:
        return {
          lead: 'Planning the wedding as well?',
          label: 'Event planning',
          link: '/vendors',
        };
    }
  });


  protected readonly store = inject(AuthStore);
  protected readonly myPortal = computed(() => landingRouteFor(this.store.roles()));

  protected readonly initials = computed(() =>
    (this.store.displayName() || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join(''),
  );

  protected readonly venueSlug = categorySlug('VENUE' as VendorCategory);
  protected readonly groups = CATEGORY_GROUPS;
  protected readonly mostBooked = MOST_BOOKED;
  protected readonly cities = CITIES.slice(0, 8);
  protected readonly religions = RELIGIONS;
  /** The tongues the seed actually carries profiles in. */
  protected readonly tongues = [
    'Telugu',
    'Hindi',
    'Tamil',
    'Kannada',
    'Malayalam',
    'Urdu',
  ];
  protected readonly totalCategories = ALL_CATEGORIES.length;

  /** Which panel is down, or null. Hover opens it; Escape and leaving close it. */
  protected readonly open = signal<'venues' | 'vendors' | 'matrimony' | null>(null);

  /**
   * Whether the narrow-screen menu panel is down.
   *
   * Closed again on every navigation rather than on a click inside the panel:
   * the links are projected by whichever shell owns them, so this component
   * cannot bind to each one, and a click handler on the container would be an
   * interaction handler on a non-focusable div. Following the router is both
   * correct for the keyboard and the thing actually being waited for - a panel
   * that survives the navigation it caused covers the page just asked for.
   */
  protected readonly menuOpen = signal(false);

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Closing is deferred by a beat, opening is not.
   *
   * Nobody moves a pointer in a straight line to a menu item, and a diagonal
   * path to the far end of a panel clips the outside of the bar on the way. An
   * immediate close punishes that; a short grace period forgives it and is
   * short enough that a genuine exit still feels instant.
   */
  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
    // Opening the menu dismisses any hover panel that was still fading out.
    this.open.set(null);
  }

  protected scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => this.open.set(null), 220);
  }

  /** Opening always wins over a close that was already on its way. */
  protected openPanel(panel: 'venues' | 'vendors' | 'matrimony' | null): void {
    this.cancelClose();
    this.open.set(panel);
  }

  protected cancelClose(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.cancelClose();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(null);
    this.menuOpen.set(false);
  }

  /**
   * The venue tiles, fetched only once the panel has actually been opened.
   *
   * Returning undefined leaves the resource idle, so a visitor who never opens
   * the menu never pays for it - which matters because this masthead is on
   * every public page, and an eager request here would be one more round trip
   * on every first paint.
   */
  protected readonly venues = httpResource<VendorSearchResult[]>(
    () =>
      this.open() === 'venues'
        ? '/api/v1/vendors/search?category=VENUE&sort=rating&limit=6'
        : undefined,
    {
      parse: (raw) => (raw as { data: VendorSearchResult[] }).data,
      defaultValue: [],
    },
  );

  protected coverOf(vendor: VendorSearchResult): string | null {
    const photos = vendor.photos ?? [];
    return (photos.find((p) => p.isCover) ?? photos[0])?.url ?? null;
  }

  protected slug(category: VendorCategory): string {
    return categorySlug(category);
  }

  protected meta(category: VendorCategory) {
    return CATEGORY_META[category];
  }
}
