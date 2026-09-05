import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import * as argon2 from 'argon2';
import {
  ErrorCode,
  OtpPurpose,
  Role,
  UserStatus,
  type SessionUser,
} from '@eventhub/contracts';

import { User, type UserDocument } from '../schemas/user.schema.js';
import { OtpService } from './otp.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import type { LoginDto, RegisterDto } from '../dto/auth.dto.js';

const CONSENT_VERSION = '2026-01-01';

/** Argon2id parameters. Deliberately not bcrypt for new work. */
const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export interface RequestMeta {
  device?: string;
  ip?: string;
}

/**
 * The roles a signed-in user may add to themselves. Kept in step with AddRoleDto,
 * which is the first line of this defence; this list is the second, for callers
 * that reach the service without passing through that DTO.
 */
const SELF_SERVICE_ROLES: readonly Role[] = ['SEEKER', 'CUSTOMER'];

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly events: EventEmitter2,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<{ challengeId: string; resendAfterSec: number; devCode?: string }> {
    if (!dto.consent) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Please accept the terms to continue',
        fields: { consent: 'Required to create an account' },
      });
    }

    const existing = await this.users.findOne({ mobile: dto.mobile });
    if (existing && existing.status !== UserStatus.PENDING_VERIFICATION) {
      throw new ConflictException({
        code: ErrorCode.AUTH_MOBILE_TAKEN,
        message: 'This number already has an account. Sign in instead.',
        fields: { mobile: 'Already registered' },
      });
    }

    // Re-registering an unverified number reuses the record rather than
    // orphaning it, so an abandoned signup can be resumed.
    const user =
      existing ??
      (await this.users.create({
        fullName: dto.fullName,
        mobile: dto.mobile,
        roles: [dto.intent],
        status: UserStatus.PENDING_VERIFICATION,
        consent: {
          accepted: true,
          version: CONSENT_VERSION,
          acceptedAt: new Date(),
        },
      }));

    const { challengeId, devCode } = await this.otp.issue(
      dto.mobile,
      OtpPurpose.REGISTRATION,
      user._id,
    );

    return { challengeId, resendAfterSec: 30, ...(devCode ? { devCode } : {}) };
  }

  async verifyRegistration(
    challengeId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<{ user: SessionUser; tokens: IssuedTokens }> {
    const { mobile } = await this.otp.verify(
      challengeId,
      code,
      OtpPurpose.REGISTRATION,
    );

    const user = await this.users.findOne({ mobile });
    if (!user) throw new UnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);

    user.mobileVerified = true;
    user.status = UserStatus.ACTIVE;
    user.lastLoginAt = new Date();
    await user.save();

    this.events.emit('user.registered', {
      userId: user.id,
      mobile: user.mobile,
      roles: user.roles,
    });

    const tokens = await this.tokens.issue(user._id, user.roles, meta);
    return { user: toSessionUser(user), tokens };
  }

  async login(
    dto: LoginDto,
    meta: RequestMeta,
  ): Promise<{ user: SessionUser; tokens: IssuedTokens }> {
    // Select the hash explicitly - the schema hides it by default.
    const user = await this.users.findOne({ mobile: dto.mobile }).select('+passwordHash');

    if (!user) {
      // Same shape and cost as a wrong password, so accounts cannot be enumerated.
      await argon2.hash('dummy-password-to-equalise-timing', ARGON_OPTS);
      throw new UnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(ErrorCode.AUTH_ACCOUNT_LOCKED);
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException(ErrorCode.AUTH_ACCOUNT_LOCKED);
    }

    if (dto.otpChallengeId && dto.otpCode) {
      await this.otp.verify(dto.otpChallengeId, dto.otpCode, OtpPurpose.LOGIN);
    } else if (dto.password) {
      const ok =
        !!user.passwordHash &&
        (await argon2.verify(user.passwordHash, dto.password));
      if (!ok) {
        await this.recordFailedLogin(user);
        throw new UnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
      }
    } else {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Provide either a password or a one-time code',
      });
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    const tokens = await this.tokens.issue(user._id, user.roles, meta);
    return { user: toSessionUser(user), tokens };
  }

  async requestLoginOtp(mobile: string): Promise<{ challengeId: string; devCode?: string }> {
    const user = await this.users.findOne({ mobile });
    // Always return a challenge, even for an unknown number, so a caller cannot
    // discover which numbers are registered.
    return this.otp.issue(mobile, OtpPurpose.LOGIN, user?._id);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const hash = await argon2.hash(password, ARGON_OPTS);
    await this.users.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: { passwordHash: hash } },
    );
  }

  /**
   * Self-service role addition, for a seeker who now wants to plan a wedding.
   *
   * Privileged roles are never grantable this way. AddRoleDto already restricts
   * the request body; this check makes the rule hold for any future caller that
   * reaches the service directly, because authentication is not authorisation
   * and ADMIN must never be self-assignable.
   */
  async addRole(userId: string, role: Role): Promise<SessionUser> {
    if (!SELF_SERVICE_ROLES.includes(role)) {
      throw new ForbiddenException({
        code: ErrorCode.AUTH_FORBIDDEN,
        message: 'That role can only be granted by an administrator.',
      });
    }

    const user = await this.users.findByIdAndUpdate(
      userId,
      { $addToSet: { roles: role } },
      { returnDocument: 'after' },
    );
    if (!user) throw new UnauthorizedException(ErrorCode.AUTH_FORBIDDEN);
    return toSessionUser(user);
  }

  async findSessionUser(userId: string): Promise<SessionUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException(ErrorCode.AUTH_FORBIDDEN);
    return toSessionUser(user);
  }

  async isMobileAvailable(mobile: string): Promise<boolean> {
    const existing = await this.users.findOne({ mobile }).select('_id status');
    return !existing || existing.status === UserStatus.PENDING_VERIFICATION;
  }

  /** Progressive lockout: 10 failures locks the account for 30 minutes. */
  private async recordFailedLogin(user: UserDocument): Promise<void> {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= 10) {
      user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }
    await user.save();
  }
}

function toSessionUser(user: UserDocument): SessionUser {
  return {
    id: user.id as string,
    fullName: user.fullName,
    mobile: user.mobile,
    email: user.email ?? null,
    roles: user.roles,
    status: user.status,
    vendor: null,
  };
}
