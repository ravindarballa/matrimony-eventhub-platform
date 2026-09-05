import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import type { VendorDto } from '@eventhub/contracts';

import { NotificationBell } from '../../../core/components/notification-bell';
import { AuthStore } from '../../auth/data/auth.store';
import { VendorApi, unwrap } from '../data/vendor-api';

/**
 * The vendor frame.
 *
 * It loads the organisation once and shows the KYC state permanently, because
 * verification is what stands between a vendor and getting paid - burying that
 * behind a menu is how a vendor quotes for a week before discovering they
 * cannot accept anything.
 */
@Component({
  selector: 'eh-vendor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatToolbarModule,
    NotificationBell,
  ],
  template: `
    <mat-toolbar class="bar">
      <a class="brand" routerLink="/vendor/enquiries">
        <span class="mark">EH</span>
        <span class="name">Vendor</span>
      </a>

      <nav class="nav">
        <a routerLink="/vendor/enquiries" routerLinkActive="on">Enquiries</a>
        <a routerLink="/vendor/calendar" routerLinkActive="on">Calendar</a>
        <a routerLink="/vendor/services" routerLinkActive="on">Catalogue</a>
        <a routerLink="/vendor/onboarding" routerLinkActive="on">Business</a>
      </nav>

      <span class="spacer"></span>

      @if (vendor.value(); as v) {
        <span class="kyc" [class]="tone(v)">{{ kycLabel(v) }}</span>
      }
      <eh-notification-bell />
      <button mat-stroked-button class="out" (click)="store.logout()">Sign out</button>
    </mat-toolbar>

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
    .bar { position: sticky; top: 0; z-index: 10; background: #1f3d2b; color: #fff;
           gap: 1.5rem; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
    .brand { display: flex; align-items: center; gap: 0.6rem; color: inherit; text-decoration: none; }
    .mark { font-weight: 800; font-size: 0.75rem; letter-spacing: 0.05em;
            background: #fff; color: #1f3d2b; border-radius: 5px; padding: 0.2rem 0.4rem; }
    .name { font-size: 1rem; font-weight: 600; }
    .nav { display: flex; gap: 1rem; }
    .nav a { color: rgb(255 255 255 / 0.75); text-decoration: none; font-size: 0.9rem;
             padding: 0.35rem 0; border-bottom: 2px solid transparent; }
    .nav a.on, .nav a:hover { color: #fff; border-bottom-color: #ffb703; }
    .spacer { flex: 1 1 auto; }
    .kyc { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
           letter-spacing: 0.04em; padding: 0.2rem 0.5rem; border-radius: 999px; }
    .kyc.good { background: #e6f4ea; color: #1b5e20; }
    .kyc.warn { background: #fbf1dc; color: #8a5a00; }
    .kyc.bad { background: #fdecea; color: #b3261e; }
    .out { --mdc-outlined-button-label-text-color: #fff;
           border-color: rgb(255 255 255 / 0.5) !important; }
    .banner { background: #fbf1dc; border-bottom: 1px solid #f2dcae; color: #6b4600;
              padding: 0.7rem 1.25rem; font-size: 0.88rem; }
    .banner a { color: #6b4600; margin-left: 0.4rem; }
    @media (max-width: 640px) { .name { display: none; } }
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
