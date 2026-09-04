import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, MinLength, validateSync } from 'class-validator';

/**
 * Fails fast at boot on a misconfigured environment. A missing JWT secret should
 * stop the process, not surface as a 500 on the first login attempt.
 */
class EnvVars {
  @IsIn(['development', 'test', 'staging', 'production'])
  NODE_ENV!: string;

  @IsInt()
  PORT!: number;

  @IsString()
  @MinLength(1)
  MONGODB_URI!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET!: string;
}

export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = plainToInstance(EnvVars, raw, { enableImplicitConversion: true });
  const errors = validateSync(parsed, { skipMissingProperties: false });

  if (errors.length > 0) {
    const detail = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return raw;
}
