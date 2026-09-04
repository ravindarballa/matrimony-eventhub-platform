import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtPayload } from '../../../core/decorators.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  /** Whatever this returns becomes `request.user`. */
  validate(payload: JwtPayload): JwtPayload {
    return {
      sub: payload.sub,
      roles: payload.roles,
      sessionId: payload.sessionId,
      ...(payload.impersonatorId ? { impersonatorId: payload.impersonatorId } : {}),
    };
  }
}
