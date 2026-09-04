import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@eventhub/contracts';

interface NestValidationBody {
  message?: string | string[];
  error?: string;
  code?: string;
  fields?: Record<string, string>;
}

/**
 * Single exit point for every error, producing the { error: { code, message,
 * fields, traceId } } envelope the client parses. Nothing else formats errors.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'Something went wrong on our end. Please try again.';
    let fields: Record<string, string> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | NestValidationBody;

      if (typeof body === 'string') {
        code = body;
        message = humanise(body);
      } else if (typeof body.message === 'string' && isErrorCode(body.message)) {
        // `new BadRequestException('EVT_SLOT_TAKEN')` does not reach the string
        // branch above - Nest wraps it as { statusCode, message, error }. So a
        // message that is shaped like one of our codes IS the code.
        code = body.message;
        message = humanise(body.message);
      } else {
        code = body.code ?? deriveCode(status, body);
        fields = body.fields;
        message = Array.isArray(body.message)
          ? 'Please correct the highlighted fields.'
          : (body.message ?? humanise(code));

        // Passport's default body is just { message: 'Unauthorized' }, which is
        // not something to show a user.
        if (status === HttpStatus.UNAUTHORIZED && message === 'Unauthorized') {
          message = 'Please sign in to continue.';
        }
      }
    }

    // 5xx is our fault and gets a stack trace; 4xx is expected traffic.
    if (status >= 500) {
      this.logger.error(
        { traceId, path: req.url, method: req.method, code },
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn({ traceId, path: req.url, method: req.method, code, status });
    }

    res.status(status).json({ error: { code, message, fields, traceId } });
  }
}

function deriveCode(status: number, body: NestValidationBody): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_FAILED;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    // Passport throws a bare UnauthorizedException with no code of its own.
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.AUTH_INVALID_CREDENTIALS;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.AUTH_FORBIDDEN;
    default:
      return body.error?.toUpperCase().replace(/\s+/g, '_') ?? ErrorCode.INTERNAL_ERROR;
  }
}

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode));

/** SCREAMING_SNAKE_CASE that we actually defined - not arbitrary user text. */
function isErrorCode(value: string): boolean {
  return KNOWN_CODES.has(value);
}

function humanise(code: string): string {
  return code
    .replace(/^[A-Z]+_/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
