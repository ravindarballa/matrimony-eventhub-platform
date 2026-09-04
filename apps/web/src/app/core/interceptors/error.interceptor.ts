import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import {
  kindForStatus,
  type ApiErrorBody,
  type AppError,
} from '../models/app-error';

/**
 * Converts every HTTP failure into a typed AppError. This is the single place
 * that knows about status codes; everything downstream reads `kind` and `code`.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse)) {
        return throwError(() => err);
      }

      const body = err.error as Partial<ApiErrorBody> | null;
      const envelope = body?.error;

      const appError: AppError = {
        kind: kindForStatus(err.status),
        code: envelope?.code ?? `HTTP_${err.status}`,
        message:
          envelope?.message ??
          (err.status === 0
            ? 'You appear to be offline. Check your connection.'
            : 'Something went wrong. Please try again.'),
        fields: envelope?.fields,
        traceId: envelope?.traceId,
        retryAfterSec: Number(err.headers.get('Retry-After')) || undefined,
      };

      return throwError(() => appError);
    }),
  );
