import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import type { Role } from '@eventhub/contracts';

import { AuthStore } from '../../features/auth/data/auth.store';

interface Portal {
  key: string;
  label: string;
  route: string;
  roles: Role[];
}

/**
 * The portals, and who may see each.
 *
 * Order is deliberate: matrimony comes first because that is where a family
 * arrives, and the wedding side second because that is where they go next.
 */
const PORTALS: Portal[] = [
  { key: 'matrimony', label: 'Matrimony', route: '/matrimony', roles: ['SEEKER'] },
  { key: 'customer', label: 'Wedding', route: '/customer', roles: ['CUSTOMER'] },
  {
    key: 'vendor',
    label: 'Vendor',
    route: '/vendor',
    roles: ['VENDOR_OWNER', 'VENDOR_STAFF'],
  },
  { key: 'admin', label: 'Admin', route: '/admin', roles: ['ADMIN', 'SUPPORT'] },
];

/**
 * Moves between the halves of the platform.
 *
 * One account holds several roles at once - a family looking for a match this
 * year is booking a venue the next, and the platform is built on exactly that
 * progression. Without this the two halves are reachable only by typing a URL,
 * which makes one product feel like two.
 *
 * It renders nothing when the account has only one portal, so a vendor never
 * sees a switcher with a single option in it.
 */
@Component({
  selector: 'eh-portal-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (available().length > 1) {
      <nav class="switch" aria-label="Switch portal">
        @for (portal of available(); track portal.key) {
          <a
            [routerLink]="portal.route"
            [class.current]="portal.key === current()"
            [attr.aria-current]="portal.key === current() ? 'page' : null"
          >
            {{ portal.label }}
          </a>
        }
      </nav>
    }
  `,
  styles: `
    .switch { display: flex; gap: 0.15rem; padding: 0.15rem;
              background: rgb(255 255 255 / 0.14); border-radius: 999px; }
    a { font-size: 0.78rem; font-weight: 600; line-height: 1;
        padding: 0.35rem 0.7rem; border-radius: 999px; text-decoration: none;
        color: rgb(255 255 255 / 0.75); white-space: nowrap; }
    a:hover { color: #fff; }
    /* The current portal reads as selected rather than as another link. */
    a.current { background: #fff; color: #23272f; }
    @media (max-width: 720px) { a { padding: 0.3rem 0.5rem; font-size: 0.72rem; } }
  `,
})
export class PortalSwitcher {
  private readonly store = inject(AuthStore);

  /** Only the portals this account's roles actually grant. */
  protected readonly available = computed(() => {
    const roles = this.store.roles();
    return PORTALS.filter((p) => p.roles.some((r) => roles.includes(r)));
  });

  private readonly router = inject(Router);

  /**
   * Navigation is a genuine event stream, so it is the one place RxJS earns its
   * place here; it becomes a signal immediately at the edge.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Which portal is being viewed, derived from the URL rather than passed in by
   * each shell - one less thing for a new shell to forget to wire up.
   */
  protected readonly current = computed(
    () => PORTALS.find((p) => this.url().startsWith(p.route))?.key ?? '',
  );
}
