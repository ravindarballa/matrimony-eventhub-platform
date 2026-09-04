import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ErrorCode, type Role } from '@eventhub/contracts';

import { Session, type SessionDocument } from '../schemas/session.schema.js';
import type { JwtPayload } from '../../../core/decorators.js';

const sha256 = (v: string): string =>
  createHash('sha256').update(v).digest('hex');

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  sessionId: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @InjectModel(Session.name)
    private readonly sessions: Model<SessionDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(
    userId: Types.ObjectId,
    roles: Role[],
    meta: { device?: string; ip?: string },
    familyId: string = randomUUID(),
  ): Promise<IssuedTokens> {
    const accessTtl = this.config.get<number>('jwt.accessTtl', 900);
    const refreshTtl = this.config.get<number>('jwt.refreshTtl', 2_592_000);

    // Opaque, high-entropy refresh token - not a JWT. Nothing is encoded in it,
    // so it carries no information if intercepted and can be revoked server-side.
    const refreshToken = randomBytes(32).toString('hex');

    const session = await this.sessions.create({
      userId,
      refreshTokenHash: sha256(refreshToken),
      familyId,
      device: meta.device ?? 'Unknown device',
      ip: meta.ip,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    const payload: JwtPayload = {
      sub: userId.toString(),
      roles,
      sessionId: session.id as string,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: accessTtl,
    });

    return {
      accessToken,
      refreshToken,
      expiresInSec: accessTtl,
      sessionId: session.id as string,
    };
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated means
   * it was stolen and replayed, so the entire token family is revoked - the
   * legitimate user is signed out too, which is the correct trade.
   */
  async rotate(
    refreshToken: string,
    meta: { device?: string; ip?: string },
  ): Promise<{ tokens: IssuedTokens; userId: Types.ObjectId }> {
    const hash = sha256(refreshToken);
    const session = await this.sessions.findOne({ refreshTokenHash: hash });

    if (!session) throw new UnauthorizedException(ErrorCode.AUTH_FORBIDDEN);

    if (session.revoked) {
      this.logger.warn(
        `Refresh token reuse detected for family ${session.familyId}; revoking family`,
      );
      await this.sessions.updateMany(
        { familyId: session.familyId },
        { $set: { revoked: true } },
      );
      throw new UnauthorizedException(ErrorCode.AUTH_TOKEN_REUSED);
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(ErrorCode.AUTH_FORBIDDEN);
    }

    // Retire this token, then mint a successor in the same family.
    session.revoked = true;
    session.lastSeenAt = new Date();
    await session.save();

    const user = await this.sessions.db
      .collection('users')
      .findOne({ _id: session.userId }, { projection: { roles: 1 } });

    const roles = (user?.['roles'] ?? []) as Role[];
    const tokens = await this.issue(session.userId, roles, meta, session.familyId);

    return { tokens, userId: session.userId };
  }

  async revokeSession(sessionId: string, userId: Types.ObjectId): Promise<void> {
    await this.sessions.updateOne(
      { _id: sessionId, userId },
      { $set: { revoked: true } },
    );
  }

  async revokeAllForUser(userId: Types.ObjectId): Promise<void> {
    await this.sessions.updateMany({ userId }, { $set: { revoked: true } });
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    await this.sessions.updateOne(
      { refreshTokenHash: sha256(refreshToken) },
      { $set: { revoked: true } },
    );
  }

  async listSessions(
    userId: Types.ObjectId,
    currentSessionId?: string,
  ): Promise<
    Array<{
      id: string;
      device: string;
      ip: string;
      lastSeenAt: string;
      isCurrent: boolean;
    }>
  > {
    const docs = await this.sessions
      .find({ userId, revoked: false })
      .sort({ lastSeenAt: -1 })
      .lean();

    return docs.map((d) => ({
      id: String(d._id),
      device: d.device,
      ip: d.ip ?? '',
      lastSeenAt: d.lastSeenAt.toISOString(),
      isCurrent: String(d._id) === currentSessionId,
    }));
  }
}
