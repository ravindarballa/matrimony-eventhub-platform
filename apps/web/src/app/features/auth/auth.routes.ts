import type { Routes } from '@angular/router';

import { guestOnlyGuard } from '../../core/guards/auth.guards';

/**
 * Lazy entry point for the auth feature. Default-exported so app.routes.ts can
 * reference it with a bare loadChildren import.
 */
export default [
  {
    /**
     * Outside the shell, deliberately.
     *
     * AuthShell is a half-and-half layout - a brand panel beside a narrow form
     * column - which suits a login box and starves a stepper. This one needs
     * the whole width for its fields, and it is long enough to deserve its own
     * masthead rather than borrowing one designed to sit next to a password
     * field. Declared before the shell so the more specific path wins.
     */
    path: 'register/matrimony',
    canActivate: [guestOnlyGuard],
    title: 'Create your matrimony profile · Matrimony EventHub',
    loadComponent: () =>
      import('./pages/matrimony-register-page').then(
        (m) => m.MatrimonyRegisterPage,
      ),
  },
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
        path: 'verify',
        title: 'Verify your number · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/verify-otp-page').then((m) => m.VerifyOtpPage),
      },
      { path: '', redirectTo: 'login', pathMatch: 'full' },
    ],
  },
] satisfies Routes;
