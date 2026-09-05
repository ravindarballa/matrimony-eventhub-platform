import type { Routes } from '@angular/router';

import { roleGuard } from '../../core/guards/auth.guards';

/** The back office. Everything under it is staff-only, guarded once. */
export default [
  {
    path: '',
    loadComponent: () =>
      import('./components/admin-shell').then((m) => m.AdminShell),
    canActivateChild: [roleGuard('ADMIN', 'SUPPORT')],
    children: [
      {
        path: 'dashboard',
        title: 'Dashboard · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/admin-dashboard-page').then((m) => m.AdminDashboardPage),
      },
      {
        path: 'kyc',
        title: 'KYC queue · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/kyc-queue-page').then((m) => m.KycQueuePage),
      },
      {
        path: 'moderation',
        title: 'Photo moderation · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/moderation-page').then((m) => m.ModerationPage),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
] satisfies Routes;
