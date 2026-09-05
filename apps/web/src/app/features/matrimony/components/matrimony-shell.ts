import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import type { MatrimonyProfileDto } from '@eventhub/contracts';

import { NotificationBell } from '../../../core/components/notification-bell';
import { PortalSwitcher } from '../../../core/components/portal-switcher';
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
    MatToolbarModule,
    NotificationBell,
    PortalSwitcher,
  ],
  template: `
    <mat-toolbar class="bar">
      <a class="brand" routerLink="/matrimony/search">
        <span class="mark">EH</span>
        <span class="name">Matrimony</span>
      </a>

      <nav class="nav">
        <a routerLink="/matrimony/search" routerLinkActive="on">Search</a>
        <a routerLink="/matrimony/interests" routerLinkActive="on">Interests</a>
        <a routerLink="/matrimony/shortlist" routerLinkActive="on">Shortlist</a>
        <a routerLink="/matrimony/profile/edit" routerLinkActive="on">My profile</a>
      </nav>

      <eh-portal-switcher />

      <span class="spacer"></span>
      <eh-notification-bell />
      <button mat-stroked-button class="out" (click)="store.logout()">Sign out</button>
    </mat-toolbar>

    @if (profile.value(); as p) {
      @if (p.status === 'DRAFT') {
        <aside class="banner" role="status">
          <strong>Your profile is not live yet.</strong>
          It is {{ p.completeness }}% complete, and needs 60% to be published.
          <a routerLink="/matrimony/profile/edit">Finish it</a>
        </aside>
      } @else if (p.status === 'ENGAGED') {
        <aside class="banner good" role="status">
          <strong>Congratulations.</strong> Your profile is marked engaged.
          <a routerLink="/customer/wedding">Start planning the wedding</a>
        </aside>
      }
    } @else if (!profile.isLoading()) {
      <aside class="banner" role="status">
        <strong>You have no profile yet.</strong>
        Search and interests need one.
        <a routerLink="/matrimony/profile/edit">Create it</a>
      </aside>
    }

    <router-outlet />
  `,
  styles: `
    .bar { position: sticky; top: 0; z-index: 10; background: #7b2d43; color: #fff;
           gap: 1.5rem; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
    .brand { display: flex; align-items: center; gap: 0.6rem; color: inherit;
             text-decoration: none; }
    .mark { font-weight: 800; font-size: 0.75rem; letter-spacing: 0.05em;
            background: #fff; color: #7b2d43; border-radius: 5px; padding: 0.2rem 0.4rem; }
    .name { font-size: 1rem; font-weight: 600; }
    .nav { display: flex; gap: 1rem; }
    .nav a { color: rgb(255 255 255 / 0.75); text-decoration: none; font-size: 0.9rem;
             padding: 0.35rem 0; border-bottom: 2px solid transparent; white-space: nowrap; }
    .nav a.on, .nav a:hover { color: #fff; border-bottom-color: #ffb703; }
    .spacer { flex: 1 1 auto; }
    .out { --mdc-outlined-button-label-text-color: #fff;
           border-color: rgb(255 255 255 / 0.5) !important; }
    .banner { background: #fbf1dc; border-bottom: 1px solid #f2dcae; color: #6b4600;
              padding: 0.7rem 1.25rem; font-size: 0.88rem; }
    .banner.good { background: #e6f4ea; border-bottom-color: #c8e6c9; color: #1b5e20; }
    .banner a { color: inherit; margin-left: 0.4rem; }
    @media (max-width: 720px) { .name { display: none; } }
  `,
})
export class MatrimonyShell {
  protected readonly store = inject(AuthStore);
  private readonly api = inject(MatrimonyApi);

  protected readonly profile = httpResource<MatrimonyProfileDto | null>(
    () => this.api.meUrl,
    { parse: unwrap<MatrimonyProfileDto | null>, defaultValue: null },
  );
}
