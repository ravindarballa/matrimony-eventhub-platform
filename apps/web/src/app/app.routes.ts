import type { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guards';

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
    path: 'forbidden',
    loadComponent: () =>
      import('./features/placeholder-page').then((m) => m.PlaceholderPage),
    data: { module: 'Not permitted', code: '403' },
  },
  { path: '', redirectTo: 'auth/login', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth/login' },
];
