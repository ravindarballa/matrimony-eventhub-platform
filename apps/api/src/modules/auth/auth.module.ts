import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { OtpService } from './services/otp.service.js';
import { TokenService } from './services/token.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { User, UserSchema } from './schemas/user.schema.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import {
  OtpChallenge,
  OtpChallengeSchema,
} from './schemas/otp-challenge.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: OtpChallenge.name, schema: OtpChallengeSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}), // secrets are supplied per-sign in TokenService
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, JwtStrategy],
  // Other modules may consume AuthService; none may touch the schemas directly.
  exports: [AuthService, TokenService],
})
export class AuthModule {}
