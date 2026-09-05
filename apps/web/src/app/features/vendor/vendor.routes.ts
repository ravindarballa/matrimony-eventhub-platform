import type { Routes } from '@angular/router';

import { roleGuard } from '../../core/guards/auth.guards';

/**
 * The vendor portal. Onboarding stays reachable at every KYC state - a vendor
 * whose verification was rejected needs the form more than anyone.
 */
export default [
  {
    path: '',
    loadComponent: () =>
      import('./components/vendor-shell').then((m) => m.VendorShell),
    canActivateChild: [roleGuard('VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN')],
    children: [
      {
        path: 'enquiries',
        title: 'Enquiries · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/enquiry-inbox-page').then((m) => m.EnquiryInboxPage),
      },
      {
        path: 'calendar',
        title: 'Calendar · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/calendar-page').then((m) => m.VendorCalendarPage),
      },
      {
        path: 'services',
        title: 'Your packages · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/vendor-services-page').then((m) => m.VendorServicesPage),
      },
      {
        path: 'onboarding',
        title: 'Your business · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/vendor-onboarding-page').then(
            (m) => m.VendorOnboardingPage,
          ),
      },
      { path: '', redirectTo: 'enquiries', pathMatch: 'full' },
    ],
  },
] satisfies Routes;
