import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type Role } from '@eventhub/contracts';

import { ROLES_KEY, type JwtPayload } from '../decorators.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on the route means role is not a constraint here.
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (!user) throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);

    const allowed = user.roles.some((r) => required.includes(r));
    if (!allowed) throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);

    return true;
  }
}
