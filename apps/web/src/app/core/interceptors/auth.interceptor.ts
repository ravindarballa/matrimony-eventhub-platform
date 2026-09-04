import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';

import { AuthStore } from '../../features/auth/data/auth.store';

/** Endpoints that must never carry a bearer token. */
const PUBLIC_PATHS = [
  '/auth/register',
  '/auth/verify-otp',
  '/auth/login',
  '/auth/refresh',
  '/auth/mobile-available',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const token = store.accessToken();

  const isPublic = PUBLIC_PATHS.some((p) => req.url.includes(p));
  if (!token || isPublic) {
    // withCredentials lets the browser attach the httpOnly refresh cookie.
    return next(req.clone({ withCredentials: true }));
  }

  return next(
    req.clone({
      withCredentials: true,
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};
