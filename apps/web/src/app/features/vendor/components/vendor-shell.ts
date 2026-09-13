import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import type { VendorDto } from '@eventhub/contracts';

import { NotificationBell } from '../../../core/components/notification-bell';
import { WeddingMasthead } from '../../../core/components/wedding-masthead';
import { AuthStore } from '../../auth/data/auth.store';
import { VendorApi, unwrap } from '../data/vendor-api';

/**
 * The vendor frame.
 *
 * It loads the organisation once and shows the KYC state permanently, because
 * verification is what stands between a vendor and getting paid - burying that
 * behind a menu is how a vendor quotes for a week before discovering they
 * cannot accept anything.
 *
 * The chrome is the shared masthead. This console used to carry a dark green
 * bar of its own, which was the last place in the product still outside the
 * single theme: a vendor who clicks through to their own public listing should
 * not feel they have changed sites. Context is 'console', so the strip above
 * offers the way back to the public site rather than a cross-sell nobody
 * working in here wants.
 */
@Component({
  selector: 'eh-vendor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    NotificationBell,
    WeddingMasthead,
  ],
  template: `
    <eh-wedding-masthead context="console">
      <nav class="nav" bar-nav>
        <a routerLink="/vendor/enquiries" routerLinkActive="on">Enquiries</a>
        <a routerLink="/vendor/calendar" routerLinkActive="on">Calendar</a>
        <a routerLink="/vendor/services" routerLinkActive="on">Catalogue</a>
        <a routerLink="/vendor/reviews" routerLinkActive="on">Reviews</a>
        <a routerLink="/vendor/onboarding" routerLinkActive="on">Business</a>
      </nav>

      <span class="end" bar-end>
        <!--
          The verification state stays in the bar rather than moving into the
          avatar menu. It is the one fact on this screen that decides whether
          the rest of the console can do anything at all.
        -->
        @if (vendor.value(); as v) {
          <span class="kyc" [class]="tone(v)">{{ kycLabel(v) }}</span>
        }

        <a
          class="avatar"
          routerLink="/account"
          [attr.aria-label]="'Account settings, ' + store.displayName()"
          [title]="store.displayName()"
        >{{ initials() }}</a>

        <eh-notification-bell />
        <button mat-stroked-button class="out" (click)="store.logout()">Sign out</button>
      </span>
    </eh-wedding-masthead>

    @if (vendor.value(); as v) {
      @if (v.kycStatus !== 'VERIFIED') {
        <aside class="banner" role="status">
          @if (v.kycStatus === 'REJECTED') {
            <strong>Verification was rejected.</strong> {{ v.kycRejectionReason }}
            <a routerLink="/vendor/onboarding">Fix and resubmit</a>
          } @else if (v.kycStatus === 'SUBMITTED' || v.kycStatus === 'IN_REVIEW') {
            <strong>Verification in review.</strong> You can list and quote now;
            bookings and payouts unlock once this clears.
          } @else {
            <strong>You are not verified yet.</strong> Customers cannot send you
            enquiries until your PAN and bank details are checked.
            <a routerLink="/vendor/onboarding">Complete verification</a>
          }
        </aside>
      }
    }

    <router-outlet />
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

    .avatar { display: grid; place-items: center; width: 2.2rem; height: 2.2rem;
              border-radius: 50%; text-decoration: none;
              background: rgb(255 255 255 / 0.16);
              border: 2px solid rgb(255 255 255 / 0.55);
              color: #fff; font-size: 0.78rem; font-weight: 700; }
    .avatar:hover, .avatar:focus-visible { border-color: #fff; }

    .kyc { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
           letter-spacing: 0.04em; padding: 0.2rem 0.5rem; border-radius: 999px;
           white-space: nowrap; }
    .kyc.good { background: #e6f4ea; color: #1b5e20; }
    .kyc.warn { background: #fbf1dc; color: #8a5a00; }
    .kyc.bad { background: #fdecea; color: #b3261e; }

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
    .banner a { color: #6b4600; margin-left: 0.4rem; }

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

    @media (max-width: 640px) {
      .kyc { display: none; }
    }
  `,
})
export class VendorShell {
  protected readonly store = inject(AuthStore);
  private readonly api = inject(VendorApi);

  /**
   * A vendor who has not onboarded has no organisation yet, so this 403s. That
   * is expected rather than exceptional: the onboarding page handles it.
   */
  protected readonly vendor = httpResource<VendorDto>(() => this.api.meUrl, {
    parse: unwrap<VendorDto>,
  });

  /** Two letters from the name, so the avatar says something without a photo. */
  protected readonly initials = computed(() => {
    const parts = this.store.displayName().trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return (parts[0][0] + (parts.at(-1)?.[0] ?? '')).toUpperCase();
  });

  protected readonly kycLabel = (v: VendorDto): string =>
    ({
      NOT_STARTED: 'Not verified',
      SUBMITTED: 'In review',
      IN_REVIEW: 'In review',
      VERIFIED: 'Verified',
      REJECTED: 'Rejected',
    })[v.kycStatus] ?? v.kycStatus;

  protected readonly tone = (v: VendorDto): string =>
    v.kycStatus === 'VERIFIED' ? 'good' : v.kycStatus === 'REJECTED' ? 'bad' : 'warn';
}
