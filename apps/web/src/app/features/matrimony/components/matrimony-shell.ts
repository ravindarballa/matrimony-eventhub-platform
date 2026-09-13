import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { profileDisplayId, type MatrimonyProfileDto } from '@eventhub/contracts';

import { NotificationBell } from '../../../core/components/notification-bell';
import { PlanTimer } from '../../../core/components/plan-timer';
import { WeddingMasthead } from '../../../core/components/wedding-masthead';
import { MatrimonyQuickLinks } from './quick-links';
import { MatrimonyQuickLinksLeft } from './quick-links-left';
import { AuthStore } from '../../auth/data/auth.store';
import { MatrimonyApi, unwrap } from '../data/matrimony-api';

/**
 * The matrimony frame.
 *
 * A member with no published profile is told so here rather than being allowed
 * to browse and then bounced at the first interest: searching requires a
 * profile, and finding that out three clicks in is a bad first impression.
 */
@Component({
  selector: 'eh-matrimony-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    NotificationBell,
    PlanTimer,
    WeddingMasthead,
    MatrimonyQuickLinks,
    MatrimonyQuickLinksLeft,
  ],
  template: `
    <!--
      The shared masthead, so the matrimony side and the public marketplace are
      visibly one product. The member's own navigation is projected into it -
      Search, Interests and the rest are not something the masthead could infer -
      and the strip above carries the cross-sell to the wedding side, which is
      what the Matrimony/Wedding toggle used to do in a control nobody asked for.
    -->
    <eh-wedding-masthead context="matrimony">
      <nav class="nav" bar-nav>
        <a routerLink="/matrimony/search" routerLinkActive="on">Search</a>
        <a routerLink="/matrimony/interests" routerLinkActive="on">Interests</a>
        <a routerLink="/matrimony/shortlist" routerLinkActive="on">Shortlist</a>
        <a routerLink="/matrimony/wall" routerLinkActive="on">Members</a>
        <a routerLink="/matrimony/videos" routerLinkActive="on">Videos</a>
        <a routerLink="/matrimony/chat" routerLinkActive="on">Chat</a>
        <a routerLink="/matrimony/profile/me" routerLinkActive="on">My profile</a>
        <a routerLink="/matrimony/plans" routerLinkActive="on">Plans</a>
        <a routerLink="/matrimony/dashboard" routerLinkActive="on">Dashboard</a>

      </nav>

      <span class="end" bar-end>
        <!--
          The member's own face, in place of the word "Account". A matrimony
          product is one where people quote their profile id down the phone and
          check their own photo is the one being shown, so the two things worth
          surfacing here are the portrait and the id - neither of which a text
          link can carry.

          Hover opens it, and so does focus, so it is reachable from a keyboard
          rather than being a mouse-only control.

          The portrait opens the menu and goes nowhere itself. It used to be a
          link to the profile as well, which meant the same gesture did two
          things: the menu appeared under the pointer and the click that was
          aimed at a row in it navigated instead. A control that opens a menu
          should open the menu and nothing else - the rows do the travelling.
        -->
        <div
          class="me"
          [class.open]="meOpen()"
          (mouseenter)="openMe()"
          (mouseleave)="closeMeSoon()"
          (focusin)="openMe()"
          (focusout)="closeMeSoon()"
        >
          <!--
            A button, not a link, because it no longer has a destination. Click
            still toggles - hover is not available on a touch screen, and
            without it the menu would be unreachable on a phone.
          -->
          <button
            type="button"
            class="avatar"
            aria-haspopup="true"
            [attr.aria-expanded]="meOpen()"
            [attr.aria-label]="'Your account, ' + (store.displayName() || 'account')"
            (click)="toggleMe()"
          >
            @if (avatar(); as url) {
              <img [src]="url" alt="" />
            } @else {
              <span class="initials">{{ initials() }}</span>
            }
          </button>

          @if (meOpen()) {
            <div class="card" role="status">
              <p class="cname">{{ store.displayName() }}</p>
              @if (profileId(); as pid) {
                <p class="cid">{{ pid }}</p>
              }

              <dl class="cfacts">
                @if (mobile(); as m) {
                  <div><dt>Mobile</dt><dd>{{ m }}</dd></div>
                }
                @if (profile.value(); as p) {
                  <div><dt>Community</dt><dd>{{ p.community }}</dd></div>
                  <div><dt>City</dt><dd>{{ p.city }}</dd></div>
                  <div><dt>Profile</dt><dd>{{ p.completeness }}% complete</dd></div>
                }
              </dl>

              <a routerLink="/matrimony/profile/me">My profile</a>
              <a routerLink="/account">Account settings</a>
            </div>
          }
        </div>

        <eh-plan-timer />
        <eh-notification-bell />
        <button mat-stroked-button class="out" (click)="store.logout()">Sign out</button>
      </span>
    </eh-wedding-masthead>

    <!--
      Every nudge here points at the profile editor, so none of them is shown ON
      the profile editor: a banner telling somebody to go and do the thing they
      are already doing is noise, and it pushes the form they came for down the
      page. The engaged banner is the exception - it congratulates rather than
      instructs, and its link goes somewhere else entirely.

      One gate decides whether any of them appears, and the hanging dashboard
      shortcut reads that same signal to know how far to hang - so a banner and
      the tag can never end up in the same band.
    -->
    @if (bannerShown()) {
      @if (profile.value(); as p) {
        @if (p.status === 'ENGAGED') {
          <aside class="banner good" role="status">
            <strong>Congratulations.</strong> Your profile is marked engaged.
            <button type="button" class="link" (click)="planWedding()">
              Start planning the wedding
            </button>
          </aside>
        } @else if (p.status === 'DRAFT') {
          <aside class="banner" role="status">
            <strong>Your profile is not live yet.</strong>
            It is {{ p.completeness }}% complete, and needs 60% to be published.
            <a routerLink="/matrimony/profile/edit">Finish it</a>
          </aside>
        } @else {
          <!--
            Published, but thin. Worth saying because completeness is not a
            vanity score here - it is what a search has to match on, and a
            profile missing its horoscope or its career simply appears in fewer
            of them.
          -->
          <aside class="banner" role="status">
            <strong>Your profile is {{ p.completeness }}% complete.</strong>
            Profiles with the horoscope and career filled in appear in more
            searches.
            <a routerLink="/matrimony/profile/edit">Add the rest</a>
          </aside>
        }
      } @else {
        <aside class="banner" role="status">
          <strong>You have no profile yet.</strong>
          Search and interests need one.
          <a routerLink="/matrimony/profile/edit">Create it</a>
        </aside>
      }
    }

    <router-outlet />

    <!--
      The floating quick links, on every matrimony screen including the
      dashboard. The tag that used to hang here was hidden on the dashboard,
      because a permanent tag pointing at the page you are already on is
      clutter with a number on it - but this is a closed menu that also holds
      the profile lookup, and the lookup is worth reaching from anywhere.
    -->
    <eh-quick-links [offset]="bannerShown() ? bannerHeight : '0rem'" />
    <eh-quick-links-left [offset]="bannerShown() ? bannerHeight : '0rem'" />

  `,
  styles: `
    /*
     * These style content projected INTO the masthead. Projected nodes keep
     * this component's encapsulation, not the masthead's, so the rules have to
     * live here - the masthead lays the slots out, this decides what fills them.
     */
    .nav { display: flex; align-items: stretch; gap: 1rem; }
    .nav a { color: rgb(255 255 255 / 0.85); text-decoration: none; font-size: 0.92rem;
             display: flex; align-items: center; padding: 0.75rem 0;
             border-bottom: 2px solid transparent; white-space: nowrap; }
    .nav a.on, .nav a:hover { color: #fff; border-bottom-color: #fff; }
    .end { display: flex; align-items: center; gap: 0.9rem; }

    /* ------------------------------------------------- the member's own menu */

    .me { position: relative; display: flex; align-items: center; }

    /*
     * A transparent bridge across the gap between the avatar and its card.
     * The card is absolutely positioned, so the gap belongs to neither element
     * and a pointer travelling down through it counted as leaving the menu -
     * the card closed before it could be reached. The bridge makes the two
     * contiguous for hit-testing while leaving the gap visible.
     */
    .me.open::after { content: ''; position: absolute; top: 100%; right: 0;
                      width: 15rem; height: 0.8rem; }
    /* A button now, so the agent stylesheet's padding and font have to be
       cleared explicitly - left in, they shrink the portrait inside its ring. */
    .avatar { display: grid; place-items: center; width: 2.2rem; height: 2.2rem;
              padding: 0; border-radius: 50%; overflow: hidden;
              text-decoration: none; cursor: pointer;
              background: rgb(255 255 255 / 0.16);
              border: 2px solid rgb(255 255 255 / 0.55);
              color: #fff; font-family: inherit; font-size: 0.78rem;
              font-weight: 700; line-height: 1; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .me:hover .avatar, .avatar:focus-visible { border-color: #fff; }

    /*
     * Right-aligned and hanging below the bar. It sits above the mega panels'
     * z-index because it is opened from further right and would otherwise be
     * covered by one that is still fading out.
     */
    .card { position: absolute; right: 0; top: calc(100% + 0.55rem); z-index: 40;
            min-width: 15rem; padding: 0.9rem 1rem;
            background: #fff; color: rgb(0 0 0 / 0.8); border-radius: 12px;
            box-shadow: 0 18px 40px rgb(0 0 0 / 0.26);
            border: 1px solid rgb(0 0 0 / 0.08); }
    .cname { margin: 0; font-size: 0.98rem; font-weight: 700; color: var(--brand-deep); }
    .cid { margin: 0.1rem 0 0; font-size: 0.74rem; letter-spacing: 0.04em;
           color: rgb(0 0 0 / 0.45); }
    .cfacts { margin: 0.75rem 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .cfacts > div { display: flex; justify-content: space-between; gap: 1rem;
                    font-size: 0.82rem; }
    .cfacts dt { color: rgb(0 0 0 / 0.5); }
    .cfacts dd { margin: 0; color: rgb(0 0 0 / 0.85); text-align: right; }
    .card a { display: block; font-size: 0.85rem; font-weight: 600;
              color: var(--brand); text-decoration: none;
              padding-top: 0.45rem; border-top: 1px solid rgb(0 0 0 / 0.07);
              margin-top: 0.45rem; }
    .card a:hover { text-decoration: underline; }
    /* The Material token alone is not enough here: the theme's own label colour
       wins, and on the maroon bar that renders as pink on maroon - technically
       present, practically unreadable. */
    /* nowrap: the label is two words and the bar is tight on a phone. */
    .out { white-space: nowrap;
           --mdc-outlined-button-label-text-color: #fff;
           color: #fff !important;
           border-color: rgb(255 255 255 / 0.55) !important; }
    .banner { background: #fbf1dc; border-bottom: 1px solid #f2dcae; color: #6b4600;
              padding: 0.7rem 1.25rem; font-size: 0.88rem; }
    .banner.good { background: #e6f4ea; border-bottom-color: #c8e6c9; color: #1b5e20; }
    .banner a { color: inherit; margin-left: 0.4rem; }
    .banner.plan { background: #eef1fb; border-bottom-color: #cfd6f2; color: var(--brand); }
    .link { border: none; background: none; padding: 0; font: inherit;
            color: inherit; text-decoration: underline; cursor: pointer;
            margin-left: 0.3rem; font-weight: 600; }
    .link:disabled { opacity: 0.6; cursor: default; }
    /*
     * Six links, an account link, a bell and a sign-out button is more than a
     * phone is wide, and it used to push the whole page sideways rather than
     * adapt - every matrimony screen scrolled horizontally on a 390px device.
     * The links scroll within their own row instead, so nothing is hidden and
     * nothing overflows the page.
     */
    /*
     * Inside the masthead's narrow-screen panel the links stack. They are
     * projected, so the masthead cannot restyle them - the shell that owns them
     * has to, and the breakpoint has to match the one the masthead collapses at.
     */
    @media (max-width: 60rem) {
      .nav { flex-direction: column; align-items: stretch; gap: 0; }
      .nav a { padding: 0.65rem 0.25rem; border-bottom: none;
               border-left: 3px solid transparent; padding-left: 0.6rem; }
      .nav a.on, .nav a:hover { border-bottom-color: transparent;
                                border-left-color: #fff;
                                background: rgb(255 255 255 / 0.1); }
    }

    @media (max-width: 720px) {
      .cfacts { font-size: 0.8rem; }
    }
  `,
})
export class MatrimonyShell {
  protected readonly store = inject(AuthStore);
  private readonly api = inject(MatrimonyApi);
  private readonly router = inject(Router);

  protected readonly profile = httpResource<MatrimonyProfileDto | null>(
    () => this.api.meUrl,
    { parse: unwrap<MatrimonyProfileDto | null>, defaultValue: null },
  );

  protected readonly meOpen = signal(false);
  private meTimer: ReturnType<typeof setTimeout> | null = null;

  /** Opening is immediate; closing waits a beat, so a slightly wandering
      pointer on its way into the card does not dismiss it. */
  protected openMe(): void {
    if (this.meTimer !== null) clearTimeout(this.meTimer);
    this.meTimer = null;
    this.meOpen.set(true);
  }

  protected closeMeSoon(): void {
    if (this.meTimer !== null) clearTimeout(this.meTimer);
    this.meTimer = setTimeout(() => this.meOpen.set(false), 220);
  }

  /**
   * For a touch screen, where there is no hover to open the menu with.
   *
   * With a pointer this fires after mouseenter has already opened the card, so
   * it reads as a close - which is the right behaviour for a second click on
   * an open menu anyway.
   */
  protected toggleMe(): void {
    if (this.meOpen()) {
      if (this.meTimer !== null) clearTimeout(this.meTimer);
      this.meTimer = null;
      this.meOpen.set(false);
      return;
    }
    this.openMe();
  }

  /**
   * Where the completeness nudge stops.
   *
   * 60% is what the API requires to publish; this is higher on purpose. A
   * profile that clears the bar is live but thin, and the fields it is still
   * missing - horoscope, career - are the ones other people filter on, so it
   * quietly appears in fewer searches than its owner expects.
   */
  protected readonly wellRounded = 90;

  /** The editor is the one page every banner here would send you to. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Whether any nudge banner is showing under the masthead.
   *
   * One source of truth, used twice: the template renders the block only when
   * this is true, and the hanging dashboard shortcut is pushed down by exactly
   * the banner's height so the two never share a band. Deriving the offset from
   * the same signal that decides the banner is what stops the two drifting -
   * the earlier version pinned the tag to the masthead and landed on top of the
   * banner on every page that had one.
   */
  protected readonly bannerShown = computed(() => {
    const p = this.profile.value();
    if (!p) return !this.profile.isLoading() && !this.onEditor();
    // Congratulation, not an errand: shown even on the pages that suppress the rest.
    if (p.status === 'ENGAGED') return true;
    if (this.onEditor()) return false;
    return p.status === 'DRAFT' || p.completeness < this.wellRounded;
  });

  /**
   * The banner is 43px: 0.7rem of padding either side of one 0.88rem line.
   * Rounded up to 44px rather than down, so the tag clears it outright instead
   * of shaving it - measured, not guessed.
   */
  protected readonly bannerHeight = '2.75rem';

  /** True on the dashboard, which carries its own shortcut and its own nudges. */
  protected readonly onDashboard = computed(() =>
    this.url().startsWith('/matrimony/dashboard'),
  );

  /**
   * Pages where a "go and finish your profile" banner is not worth its space.
   *
   * The editor, because it is the page the banner links to. Plans, because
   * somebody reading prices is mid-decision about paying, and interrupting that
   * with an unrelated errand is the worst moment to do it. The dashboard,
   * because its Next steps list says the same thing in more detail - two
   * copies of one nudge, stacked, reads as a broken page rather than as
   * emphasis.
   */
  protected readonly onEditor = computed(
    () =>
      this.url().startsWith('/matrimony/profile/edit') ||
      this.url().startsWith('/matrimony/plans') ||
      this.onDashboard(),
  );

  /**
   * The member's own primary photo.
   *
   * Only an APPROVED one. A pending upload is visible to its owner on the
   * profile editor, where the moderation state is shown beside it, but putting
   * it in the masthead would quietly imply it had gone live.
   */
  protected readonly avatar = computed(() => {
    const photos = this.profile.value()?.photos ?? [];
    const primary = photos.find((p) => p.isPrimary && p.moderation === 'APPROVED');
    return (primary ?? photos.find((p) => p.moderation === 'APPROVED'))?.url ?? null;
  });

  /** Falls back to initials, so the control is never an empty circle. */
  protected readonly initials = computed(() =>
    (this.store.displayName() || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join(''),
  );

  protected readonly profileId = computed(() => {
    const id = this.profile.value()?.id;
    return id ? profileDisplayId(id) : null;
  });

  protected readonly mobile = computed(() => this.store.user()?.mobile ?? null);

  /**
   * Grants the customer role if it is missing, then opens the planner. Doing it
   * in that order is what stops the wedding side being a locked door for the
   * seekers it is meant for.
   */
  protected async planWedding(): Promise<void> {
    if (!this.store.isCustomer()) await this.store.becomeCustomer();
    await this.router.navigateByUrl('/customer/wedding');
  }
}
