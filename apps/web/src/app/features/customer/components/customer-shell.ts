import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

import { NotificationBell } from '../../../core/components/notification-bell';
import { WeddingMasthead } from '../../../core/components/wedding-masthead';
import { AuthStore } from '../../auth/data/auth.store';

/**
 * The frame every customer screen sits in. It holds the session-dependent
 * chrome - who is signed in, where they can go, how they leave - so no page
 * has to think about any of it.
 *
 * The chrome is the shared masthead rather than a toolbar of its own. A
 * customer moves between the public marketplace and their own bookings
 * constantly - browse a caterer, enquire, come back to compare quotes - and
 * until now the header changed shape at that boundary, which reads as leaving
 * the site rather than as going one level deeper into it.
 *
 * Context is 'wedding': a customer is here to plan one, so the thin strip above
 * advertises the matrimony side, which is the half they are not already in.
 */
@Component({
  selector: 'eh-customer-shell',
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
    <eh-wedding-masthead context="wedding">
      <nav class="nav" bar-nav>
        <a routerLink="/customer/vendors" routerLinkActive="on">Find vendors</a>
        <a routerLink="/customer/enquiries" routerLinkActive="on">Enquiries</a>
        <a routerLink="/customer/bookings" routerLinkActive="on">Bookings</a>
      </nav>

      <span class="end" bar-end>
        <!--
          The initialled avatar the rest of the product uses, in its smallest
          form. The portal switcher that used to sit in this bar is gone: the
          strip above is the cross-sell now, and two controls offering the same
          journey is how the Matrimony/Wedding toggle became clutter.
        -->
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

    /* The Material token alone is not enough here: the theme's own label colour
       wins, and on the maroon bar that renders as pink on maroon - technically
       present, practically unreadable. */
    /* nowrap: the label is two words and the bar is tight on a phone. */
    .out { white-space: nowrap;
           --mdc-outlined-button-label-text-color: #fff;
           color: #fff !important;
           border-color: rgb(255 255 255 / 0.55) !important; }

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
    }
  `,
})
export class CustomerShell {
  protected readonly store = inject(AuthStore);

  /** Two letters from the name, so the avatar says something without a photo. */
  protected readonly initials = computed(() => {
    const parts = this.store.displayName().trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return (parts[0][0] + (parts.at(-1)?.[0] ?? '')).toUpperCase();
  });
}
