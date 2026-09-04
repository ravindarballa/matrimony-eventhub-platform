import { inject } from '@angular/core';
import { RedirectCommand, Router, type CanActivateFn } from '@angular/router';
import type { Role } from '@eventhub/contracts';

import { AuthStore } from '../../features/auth/data/auth.store';

/** Where each role lands after signing in. */
export function landingRouteFor(roles: readonly Role[]): string {
  if (roles.includes('ADMIN') || roles.includes('SUPPORT')) return '/admin';
  if (roles.includes('VENDOR_OWNER') || roles.includes('VENDOR_STAFF')) return '/vendor';
  if (roles.includes('CUSTOMER')) return '/customer';
  return '/matrimony/search';
}

export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(AuthStore);
  const router = inject(Router);

  if (store.isAuthenticated()) return true;

  // Preserve where they were going so login can send them back.
  return new RedirectCommand(
    router.createUrlTree(['/auth/login'], {
      queryParams: { returnUrl: state.url },
    }),
  );
};

/** Keeps a signed-in user out of the login and register screens. */
export const guestOnlyGuard: CanActivateFn = () => {
  const store = inject(AuthStore);
  const router = inject(Router);

  if (!store.isAuthenticated()) return true;
  return new RedirectCommand(router.parseUrl(landingRouteFor(store.roles())));
};

/**
 * roleGuard('ADMIN', 'SUPPORT') - redirects rather than returning false, so the
 * user gets an explanation instead of a silently cancelled navigation.
 */
export const roleGuard =
  (...allowed: Role[]): CanActivateFn =>
  () => {
    const store = inject(AuthStore);
    const router = inject(Router);

    if (!store.isAuthenticated()) {
      return new RedirectCommand(router.parseUrl('/auth/login'));
    }
    return store.roles().some((r) => allowed.includes(r))
      ? true
      : new RedirectCommand(router.parseUrl('/forbidden'));
  };
