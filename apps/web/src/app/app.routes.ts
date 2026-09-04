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
    path: 'matrimony',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/placeholder-page').then((m) => m.PlaceholderPage),
    data: { module: 'Matrimony', code: 'MAT' },
  },
  {
    path: 'customer',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/placeholder-page').then((m) => m.PlaceholderPage),
    data: { module: 'Customer portal', code: 'CUS' },
  },
  {
    path: 'vendor',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/placeholder-page').then((m) => m.PlaceholderPage),
    data: { module: 'Vendor portal', code: 'VND' },
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/placeholder-page').then((m) => m.PlaceholderPage),
    data: { module: 'Admin portal', code: 'ADM' },
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
