import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';

import { AuthStore } from '../../auth/data/auth.store';
import { NotificationBell } from '../../../core/components/notification-bell';
import { PortalSwitcher } from '../../../core/components/portal-switcher';

/** The back-office frame. Deliberately plain: it is a work surface. */
@Component({
  selector: 'eh-admin-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatToolbarModule,
    NotificationBell,
    PortalSwitcher,
  ],
  template: `
    <mat-toolbar class="bar">
      <a class="brand" routerLink="/admin/dashboard">
        <span class="mark">EH</span>
        <span class="name">Admin</span>
      </a>

      <nav class="nav">
        <a routerLink="/admin/dashboard" routerLinkActive="on">Dashboard</a>
        <a routerLink="/admin/kyc" routerLinkActive="on">KYC queue</a>
        <a routerLink="/admin/moderation" routerLinkActive="on">Photos</a>
      </nav>

      <eh-portal-switcher />

      <span class="spacer"></span>
      @if (store.user(); as user) {
        <a class="who" routerLink="/account" title="Account settings">{{ user.fullName }}</a>
      }
      <eh-notification-bell />
      <button mat-stroked-button class="out" (click)="store.logout()">Sign out</button>
    </mat-toolbar>

    <router-outlet />
  `,
  styles: `
    .bar { position: sticky; top: 0; z-index: 10; background: #23272f; color: #fff;
           gap: 1.5rem; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
    .brand { display: flex; align-items: center; gap: 0.6rem; color: inherit;
             text-decoration: none; }
    .mark { font-weight: 800; font-size: 0.75rem; letter-spacing: 0.05em;
            background: #fff; color: #23272f; border-radius: 5px; padding: 0.2rem 0.4rem; }
    .name { font-size: 1rem; font-weight: 600; }
    .nav { display: flex; gap: 1rem; }
    .nav a { color: rgb(255 255 255 / 0.72); text-decoration: none; font-size: 0.9rem;
             padding: 0.35rem 0; border-bottom: 2px solid transparent; }
    .nav a.on, .nav a:hover { color: #fff; border-bottom-color: #ffb703; }
    .spacer { flex: 1 1 auto; }
    .who { text-decoration: none;  font-size: 0.85rem; opacity: 0.8; }
    .out { --mdc-outlined-button-label-text-color: #fff;
           border-color: rgb(255 255 255 / 0.45) !important; }
    @media (max-width: 640px) { .name, .who { display: none; } }
  `,
})
export class AdminShell {
  protected readonly store = inject(AuthStore);
}
