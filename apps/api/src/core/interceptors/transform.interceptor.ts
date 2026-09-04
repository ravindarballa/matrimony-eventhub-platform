import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { ApiResponse, PageMeta } from '@eventhub/contracts';

/** Marker a service can return so the interceptor lifts `meta` out of the body. */
export interface WithMeta<T> {
  items: T;
  meta: PageMeta;
}

const hasMeta = <T>(v: unknown): v is WithMeta<T> =>
  typeof v === 'object' && v !== null && 'items' in v && 'meta' in v;

/**
 * Wraps every successful response in { data, meta } so the client has exactly
 * one shape to parse. Errors are shaped separately by AllExceptionsFilter.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload) =>
        hasMeta<T>(payload)
          ? { data: payload.items, meta: payload.meta }
          : { data: payload },
      ),
    );
  }
}
