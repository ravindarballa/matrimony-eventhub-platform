import type { Routes } from '@angular/router';

import { authGuard, guestOnlyGuard } from './core/guards/auth.guards';

/**
 * Every feature is lazy-loaded. Only the shell and the auth store ship in the
 * initial bundle, which is what keeps it inside the 500 kB budget.
 */
export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes'),
  },
  {
    path: 'account',
    canActivate: [authGuard],
    title: 'Your account · Matrimony EventHub',
    loadComponent: () =>
      import('./features/account/pages/account-page').then((m) => m.AccountPage),
  },
  {
    path: 'matrimony',
    canActivate: [authGuard],
    loadChildren: () => import('./features/matrimony/matrimony.routes'),
  },
  {
    path: 'customer',
    canActivate: [authGuard],
    loadChildren: () => import('./features/customer/customer.routes'),
  },
  {
    path: 'vendor',
    canActivate: [authGuard],
    loadChildren: () => import('./features/vendor/vendor.routes'),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadChildren: () => import('./features/admin/admin.routes'),
  },
  {
    // Public by design: this is the only route a visitor with no account can
    // do something real on, so it carries no authGuard. guestOnlyGuard sends
    // an already-signed-in customer to the ordinary search instead, where
    // their wedding and past enquiries are already known.
    path: 'enquire',
    canActivate: [guestOnlyGuard],
    title: 'Get quotes · Matrimony EventHub',
    loadComponent: () =>
      import('./features/enquire/pages/guest-enquiry-page').then(
        (m) => m.GuestEnquiryPage,
      ),
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./features/placeholder-page').then((m) => m.PlaceholderPage),
    data: { module: 'Not permitted', code: '403' },
  },
  {
    // The front door, and public. Sending an unknown visitor to a login form
    // asks them to commit before they have seen anything.
    path: '',
    pathMatch: 'full',
    title: 'Matrimony EventHub · Matches and wedding vendors',
    loadComponent: () =>
      import('./features/home/pages/home-page').then((m) => m.HomePage),
  },
  { path: '**', redirectTo: '' },
];
