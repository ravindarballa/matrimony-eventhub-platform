import { inject } from '@angular/core';
import { HttpClient, type HttpInterceptorFn } from '@angular/common/http';
import {
  catchError,
  finalize,
  map,
  shareReplay,
  switchMap,
  throwError,
  type Observable,
} from 'rxjs';
import type { AuthResponse } from '@eventhub/contracts';

import { AuthStore } from '../../features/auth/data/auth.store';
import type { AppError } from '../models/app-error';

/**
 * Module-scoped so every request that 401s during the same window shares ONE
 * refresh call.
 *
 * This matters for correctness, not just efficiency: the API rotates refresh
 * tokens and treats a replayed one as theft, revoking the whole token family.
 * Six parallel refreshes would present the same rotated token six times and log
 * the user out.
 */
let refresh$: Observable<string> | null = null;

export const refreshInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const http = inject(HttpClient);

  return next(req).pipe(
    catchError((err: AppError) => {
      const isAuthCall = req.url.includes('/auth/');
      if (err.kind !== 'auth' || isAuthCall) return throwError(() => err);

      refresh$ ??= http
        .post<{ data: AuthResponse }>('/api/v1/auth/refresh', {}, { withCredentials: true })
        .pipe(
          map((res) => {
            store.setSession(res.data.user, res.data.accessToken);
            return res.data.accessToken;
          }),
          finalize(() => {
            refresh$ = null; // release the gate whether it succeeded or not
          }),
          shareReplay({ bufferSize: 1, refCount: true }),
        );

      return refresh$.pipe(
        switchMap((token) =>
          next(
            req.clone({
              withCredentials: true,
              setHeaders: { Authorization: `Bearer ${token}` },
            }),
          ),
        ),
        catchError(() => {
          store.clearSession();
          return throwError(() => err);
        }),
      );
    }),
  );
};
