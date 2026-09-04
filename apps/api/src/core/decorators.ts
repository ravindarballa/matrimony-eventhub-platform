import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Role } from '@eventhub/contracts';

export const IS_PUBLIC_KEY = 'isPublic';
/** Opt a route out of the globally applied JwtAuthGuard. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restrict a route to the listed roles. Enforced by RolesGuard. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export interface JwtPayload {
  sub: string;
  roles: Role[];
  sessionId: string;
  /** Present only while a support agent is impersonating this user. */
  impersonatorId?: string;
  iat?: number;
  exp?: number;
}

/** Injects the verified JWT payload, or one property of it. */
export const CurrentUser = createParamDecorator(
  (key: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) return undefined;
    return key ? user[key] : user;
  },
);
