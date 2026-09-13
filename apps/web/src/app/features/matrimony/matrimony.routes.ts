import type { Routes } from '@angular/router';

import { roleGuard } from '../../core/guards/auth.guards';

/**
 * The matrimony feature.
 *
 * `profile/edit` is declared before `profile/:id`, or the literal segment would
 * be swallowed by the parameter route and the editor would try to load a
 * profile called "edit".
 */
export default [
  {
    path: '',
    loadComponent: () =>
      import('./components/matrimony-shell').then((m) => m.MatrimonyShell),
    canActivateChild: [roleGuard('SEEKER', 'CUSTOMER', 'ADMIN')],
    children: [
      {
        path: 'dashboard',
        title: 'Dashboard · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/dashboard-page').then((m) => m.MatrimonyDashboardPage),
      },
      {
        path: 'search',
        title: 'Find a match · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/search-page').then((m) => m.MatrimonySearchPage),
      },
      {
        path: 'wall',
        title: 'Members · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/wall-page').then((m) => m.MatrimonyWallPage),
      },
      {
        path: 'videos',
        title: 'See the work · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/videos-page').then((m) => m.MatrimonyVideosPage),
      },
      {
        path: 'interests',
        title: 'Interests · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/interests-page').then((m) => m.InterestsPage),
      },
      {
        path: 'shortlist',
        title: 'Shortlist · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/shortlist-page').then((m) => m.ShortlistPage),
      },
      {
        path: 'chat',
        title: 'Conversations · Matrimony EventHub',
        loadComponent: () => import('./pages/chat-page').then((m) => m.ChatPage),
      },
      {
        path: 'plans',
        title: 'Plans · Matrimony EventHub',
        loadComponent: () => import('./pages/plans-page').then((m) => m.PlansPage),
      },
      {
        // Literal, so it is declared above `profile/:id` for the same reason
        // `profile/edit` is - otherwise "me" is read as somebody's id.
        path: 'profile/me',
        title: 'Your profile · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/profile-me-page').then((m) => m.MatrimonyProfileMePage),
      },
      {
        path: 'profile/edit',
        title: 'Edit your profile · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/profile-edit-page').then(
            (m) => m.MatrimonyProfileEditPage,
          ),
      },
      {
        path: 'profile/:id',
        title: 'Profile · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/profile-detail-page').then(
            (m) => m.MatrimonyProfileDetailPage,
          ),
      },
      { path: '', redirectTo: 'search', pathMatch: 'full' },
    ],
  },
] satisfies Routes;
