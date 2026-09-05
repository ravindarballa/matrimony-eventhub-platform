import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '@eventhub/contracts';

import type { JwtPayload } from '../../../core/decorators.js';
import { Session, type SessionDocument } from '../schemas/session.schema.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(Session.name)
    private readonly sessions: Model<SessionDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  /**
   * Whatever this returns becomes `request.user`.
   *
   * The session behind the token is checked, not just the signature. A JWT is
   * self-contained, so without this a revoked session keeps working until the
   * token expires - which would make two features quietly untrue: "sign out
   * this device" would not, and changing a password would not turf out whoever
   * prompted the change. Fifteen minutes is a long time to be wrong about that.
   *
   * The cost is one indexed lookup per authenticated request, on a projection
   * of two fields. That is a fair price for logout meaning logout; if it ever
   * shows up in a profile, the answer is to cache revocations in Redis rather
   * than to stop checking.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sessionId || !Types.ObjectId.isValid(payload.sessionId)) {
      throw new UnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    const session = await this.sessions
      .findById(payload.sessionId)
      .select('revoked expiresAt')
      .lean();

    if (!session || session.revoked || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    return {
      sub: payload.sub,
      roles: payload.roles,
      sessionId: payload.sessionId,
      ...(payload.impersonatorId ? { impersonatorId: payload.impersonatorId } : {}),
    };
  }
}
