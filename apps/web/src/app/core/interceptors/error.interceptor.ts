import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { isDevMode } from '@angular/core';
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
        message: envelope?.message ?? fallbackMessage(err.status),
        fields: envelope?.fields,
        traceId: envelope?.traceId,
        retryAfterSec: Number(err.headers.get('Retry-After')) || undefined,
      };

      return throwError(() => appError);
    }),
  );

/**
 * What to say when the response carried no error envelope.
 *
 * Every error the API produces goes through AllExceptionsFilter, so a missing
 * envelope means the answer did not come from the API at all - in development,
 * almost always the dev-server proxy failing to reach a NestJS process nobody
 * started. "Something went wrong" sends a developer hunting through the form
 * they just submitted rather than the terminal they forgot to open, so in a dev
 * build it says which process is missing. Production keeps the neutral wording:
 * a family booking a wedding cannot act on a port number.
 */
function fallbackMessage(status: number): string {
  if (status === 0) return 'You appear to be offline. Check your connection.';

  return isDevMode()
    ? `The API did not respond (HTTP ${status}). Is it running on http://localhost:3000? Start it with "npm run dev:api", and a database with "npm run dev:mongo".`
    : 'Something went wrong. Please try again.';
}
