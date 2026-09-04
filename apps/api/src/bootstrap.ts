import {
  BadRequestException,
  ValidationPipe,
  VersioningType,
  type INestApplication,
  type ValidationError,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ErrorCode } from '@eventhub/contracts';

/**
 * Everything that shapes request and response handling, applied identically by
 * main.ts and by the e2e tests. Keeping it here is what stops a test passing
 * against a differently-configured app than the one that actually ships.
 */
export function configureApp(
  app: INestApplication,
  opts: { prefix?: string } = {},
): void {
  app.use(cookieParser());

  // The prefix must NOT contain the version - URI versioning appends /v1 itself.
  app.setGlobalPrefix(opts.prefix ?? 'api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // and reject requests that send them
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => new BadRequestException(toValidationBody(errors)),
    }),
  );
}

/**
 * Flattens nested validation errors into { field path -> first message }, which
 * maps directly onto Signal Forms field paths on the client.
 */
export function toValidationBody(errors: ValidationError[]): {
  code: string;
  message: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};

  const walk = (errs: ValidationError[], prefix = ''): void => {
    for (const err of errs) {
      const path = prefix ? `${prefix}.${err.property}` : err.property;
      const first = err.constraints ? Object.values(err.constraints)[0] : undefined;
      if (first && !fields[path]) fields[path] = first;
      if (err.children?.length) walk(err.children, path);
    }
  };
  walk(errors);

  return {
    code: ErrorCode.VALIDATION_FAILED,
    message: 'Please correct the highlighted fields.',
    fields,
  };
}
