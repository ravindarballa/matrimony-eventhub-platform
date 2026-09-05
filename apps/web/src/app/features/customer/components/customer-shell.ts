import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';

import { NotificationBell } from '../../../core/components/notification-bell';
import { AuthStore } from '../../auth/data/auth.store';

/**
 * The frame every customer screen sits in. It holds the session-dependent
 * chrome - who is signed in, where they can go, how they leave - so no page
 * has to think about any of it.
 */
@Component({
  selector: 'eh-customer-shell',
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
      <a class="brand" routerLink="/customer/bookings">
        <span class="mark">EH</span>
        <span class="name">Matrimony EventHub</span>
      </a>

      <nav class="nav">
        <a routerLink="/customer/vendors" routerLinkActive="on">Find vendors</a>
        <a routerLink="/customer/enquiries" routerLinkActive="on">Enquiries</a>
        <a routerLink="/customer/bookings" routerLinkActive="on">Bookings</a>
      </nav>

      <span class="spacer"></span>

      @if (store.user(); as user) {
        <span class="who" title="Signed in">{{ user.fullName }}</span>
      }
      <eh-notification-bell />
      <button mat-stroked-button class="out" (click)="store.logout()">Sign out</button>
    </mat-toolbar>

    <router-outlet />
  `,
  styles: `
    .bar {
      position: sticky; top: 0; z-index: 10;
      background: #2f2d78; color: #fff; gap: 1.5rem;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    }
    .brand { display: flex; align-items: center; gap: 0.6rem; color: inherit; text-decoration: none; }
    .mark {
      font-weight: 800; font-size: 0.75rem; letter-spacing: 0.05em;
      background: #fff; color: #2f2d78; border-radius: 5px; padding: 0.2rem 0.4rem;
    }
    .name { font-size: 1rem; font-weight: 600; }
    .nav { display: flex; gap: 1rem; }
    .nav a {
      color: rgb(255 255 255 / 0.75); text-decoration: none; font-size: 0.9rem;
      padding: 0.35rem 0; border-bottom: 2px solid transparent;
    }
    .nav a.on, .nav a:hover { color: #fff; border-bottom-color: #ffb703; }
    .spacer { flex: 1 1 auto; }
    .who { font-size: 0.85rem; opacity: 0.85; }
    .out { --mdc-outlined-button-label-text-color: #fff; border-color: rgb(255 255 255 / 0.5) !important; }

    @media (max-width: 640px) {
      .name { display: none; }
      .who { display: none; }
    }
  `,
})
export class CustomerShell {
  protected readonly store = inject(AuthStore);
}
