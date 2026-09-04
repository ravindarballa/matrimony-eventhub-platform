import { ErrorCode } from '@eventhub/contracts';

/**
 * The normalised error every part of the app deals with. The HTTP interceptor
 * converts each failure into one of these, so components never inspect an
 * HttpErrorResponse or a status code directly.
 */
export interface AppError {
  kind: 'validation' | 'auth' | 'conflict' | 'gone' | 'rate-limit' | 'offline' | 'server';
  code: string;
  message: string;
  /** Field path -> message, mapping onto Signal Forms field paths. */
  fields?: Record<string, string>;
  traceId?: string;
  retryAfterSec?: number;
}

/** The error envelope the API returns. Mirrors ApiError in @eventhub/contracts. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    traceId: string;
  };
}

export function kindForStatus(status: number): AppError['kind'] {
  if (status === 0) return 'offline';
  if (status === 400 || status === 422) return 'validation';
  if (status === 401 || status === 403) return 'auth';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status === 429) return 'rate-limit';
  return 'server';
}

export const GENERIC_ERROR: AppError = {
  kind: 'server',
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Something went wrong. Please try again.',
};
