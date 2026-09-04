import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { createHash, randomInt } from 'node:crypto';
import { ErrorCode, type OtpPurpose } from '@eventhub/contracts';

import {
  OtpChallenge,
  type OtpChallengeDocument,
} from '../schemas/otp-challenge.schema.js';

const sha256 = (v: string): string =>
  createHash('sha256').update(v).digest('hex');

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectModel(OtpChallenge.name)
    private readonly challenges: Model<OtpChallengeDocument>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issues a challenge and dispatches the code over SMS. The plaintext code is
   * returned to the caller only outside production, so local development does
   * not need a live SMS provider - it is never placed in an HTTP response.
   */
  async issue(
    mobile: string,
    purpose: OtpPurpose,
    userId?: Types.ObjectId,
  ): Promise<{ challengeId: string; devCode?: string }> {
    const ttl = this.config.get<number>('otp.ttlSeconds', 600);

    // randomInt is CSPRNG-backed; Math.random would be predictable.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    // Supersede any outstanding challenge for this mobile and purpose.
    await this.challenges.updateMany(
      { mobile, purpose, consumed: false },
      { $set: { consumed: true } },
    );

    const doc = await this.challenges.create({
      mobile,
      purpose,
      userId,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });

    // TODO: replace with the MSG91 DLT-registered template send.
    const isProd = this.config.get<string>('nodeEnv') === 'production';
    if (!isProd) {
      this.logger.debug(`OTP for ${mobile} (${purpose}): ${code}`);
    }

    return {
      challengeId: doc.id as string,
      ...(isProd ? {} : { devCode: code }),
    };
  }

  /**
   * Verifies and consumes a challenge. Attempts are counted so a 6-digit code
   * cannot be brute forced; exhausting them destroys the challenge.
   */
  async verify(
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<{ mobile: string; userId?: Types.ObjectId }> {
    const maxAttempts = this.config.get<number>('otp.maxAttempts', 5);

    if (!Types.ObjectId.isValid(challengeId)) {
      throw new BadRequestException(ErrorCode.AUTH_OTP_INVALID);
    }

    const challenge = await this.challenges.findById(challengeId);

    if (!challenge || challenge.consumed || challenge.purpose !== purpose) {
      throw new BadRequestException(ErrorCode.AUTH_OTP_INVALID);
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new GoneException(ErrorCode.AUTH_OTP_EXPIRED);
    }
    if (challenge.attempts >= maxAttempts) {
      challenge.consumed = true;
      await challenge.save();
      throw new GoneException(ErrorCode.AUTH_OTP_EXPIRED);
    }

    if (challenge.codeHash !== sha256(code)) {
      challenge.attempts += 1;
      await challenge.save();
      throw new BadRequestException(ErrorCode.AUTH_OTP_INVALID);
    }

    challenge.consumed = true;
    await challenge.save();

    return {
      mobile: challenge.mobile,
      ...(challenge.userId ? { userId: challenge.userId } : {}),
    };
  }
}
