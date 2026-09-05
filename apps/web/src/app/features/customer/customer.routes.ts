import type { Routes } from '@angular/router';

import { roleGuard } from '../../core/guards/auth.guards';

/**
 * The customer portal. Default-exported so app.routes.ts can reference it with
 * a bare loadChildren import, and role-guarded as a whole rather than per page.
 */
export default [
  {
    path: '',
    loadComponent: () =>
      import('./components/customer-shell').then((m) => m.CustomerShell),
    canActivateChild: [roleGuard('CUSTOMER', 'ADMIN', 'SUPPORT')],
    children: [
      {
        path: 'wedding',
        title: 'Your wedding · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/wedding-setup-page').then((m) => m.WeddingSetupPage),
      },
      {
        path: 'vendors',
        title: 'Find vendors · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/vendor-search-page').then((m) => m.VendorSearchPage),
      },
      {
        path: 'enquiries',
        title: 'Your enquiries · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/enquiries-page').then((m) => m.EnquiriesPage),
      },
      {
        path: 'enquiries/:id',
        title: 'Compare quotes · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/quote-comparison-page').then((m) => m.QuoteComparisonPage),
      },
      {
        path: 'bookings',
        title: 'Your bookings · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/bookings-page').then((m) => m.BookingsPage),
      },
      {
        // `id` binds to the page's input() signal, so no component here reads
        // ActivatedRoute.
        path: 'bookings/:id',
        title: 'Booking · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/booking-detail-page').then((m) => m.BookingDetailPage),
      },
      {
        path: 'bookings/:bookingId/pay/:milestone',
        title: 'Checkout · Matrimony EventHub',
        loadComponent: () =>
          import('./pages/checkout-page').then((m) => m.CheckoutPage),
      },
      { path: '', redirectTo: 'bookings', pathMatch: 'full' },
    ],
  },
] satisfies Routes;
