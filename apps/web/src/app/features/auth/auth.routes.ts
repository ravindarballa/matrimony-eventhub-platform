import type { Routes } from '@angular/router';

import { guestOnlyGuard } from '../../core/guards/auth.guards';

/**
 * Lazy entry point for the auth feature. Default-exported so app.routes.ts can
 * reference it with a bare loadChildren import.
 */
export default [
  {
    path: '',
    loadComponent: () =>
      import('./components/auth-shell').then((m) => m.AuthShell),
    canActivateChild: [guestOnlyGuard],
    children: [
      {
        path: 'login',
        title: 'Sign in · Matrimony EventHub',
        loadComponent: () => import('./pages/login-page').then((m) => m.LoginPage),
      },
      {
        path: 'register',
        title: 'Create your account · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/register-page').then((m) => m.RegisterPage),
      },
      {
        // Its own page, not a mode of the ordinary one. A member needs a
        // profile, not just an account, and conditionally growing one form into
        // two different signups is how forms become unreadable.
        path: 'register/matrimony',
        title: 'Create your matrimony profile · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/matrimony-register-page').then(
            (m) => m.MatrimonyRegisterPage,
          ),
      },
      {
        path: 'verify',
        title: 'Verify your number · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/verify-otp-page').then((m) => m.VerifyOtpPage),
      },
      { path: '', redirectTo: 'login', pathMatch: 'full' },
    ],
  },
] satisfies Routes;
