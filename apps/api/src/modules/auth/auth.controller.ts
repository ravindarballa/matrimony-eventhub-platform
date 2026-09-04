import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '../../core/throttle/throttle.guard.js';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { ErrorCode, OtpPurpose, type SessionUser } from '@eventhub/contracts';

import { CurrentUser, Public, type JwtPayload } from '../../core/decorators.js';
import {
  AddRoleDto,
  LoginDto,
  RegisterDto,
  SetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';
import { AuthService, type RequestMeta } from './services/auth.service.js';
import { TokenService, type IssuedTokens } from './services/token.service.js';

const REFRESH_COOKIE = 'eh_rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ limit: 5, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Create an account and dispatch an OTP' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('verify-otp')
  @Throttle({ limit: 5, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Confirm the OTP and issue a session' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.purpose !== OtpPurpose.REGISTRATION) {
      throw new UnauthorizedException(ErrorCode.AUTH_OTP_INVALID);
    }
    const { user, tokens } = await this.auth.verifyRegistration(
      dto.challengeId,
      dto.code,
      meta(req),
    );
    return this.respondWithSession(res, user, tokens);
  }

  @Public()
  @Post('login')
  @Throttle({ limit: 5, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Sign in with a password or a one-time code' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto, meta(req));
    return this.respondWithSession(res, user, tokens);
  }

  @Public()
  @Post('login/otp')
  @Throttle({ limit: 5, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Send a login OTP' })
  requestLoginOtp(@Body('mobile') mobile: string) {
    return this.auth.requestLoginOtp(mobile);
  }

  /**
   * Reads the refresh token from the httpOnly cookie - the client cannot and
   * should not be able to send it explicitly.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the session tokens' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (!token) throw new UnauthorizedException(ErrorCode.AUTH_FORBIDDEN);

    const { tokens, userId } = await this.tokens.rotate(token, meta(req));
    const user = await this.auth.findSessionUser(userId.toString());
    return this.respondWithSession(res, user, tokens);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (token) await this.tokens.revokeByToken(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { success: true };
  }

  @Public()
  @Get('mobile-available')
  @ApiOperation({ summary: 'Advisory uniqueness check for the signup form' })
  async mobileAvailable(@Query('m') mobile: string) {
    return { available: await this.auth.isMobileAvailable(mobile) };
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.auth.findSessionUser(userId);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  async setPassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: SetPasswordDto,
  ) {
    await this.auth.setPassword(userId, dto.password);
    return { success: true };
  }

  @Post('roles')
  addRole(@CurrentUser('sub') userId: string, @Body() dto: AddRoleDto) {
    return this.auth.addRole(userId, dto.role);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: JwtPayload) {
    return this.tokens.listSessions(new Types.ObjectId(user.sub), user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    await this.tokens.revokeSession(id, new Types.ObjectId(userId));
  }

  /**
   * The refresh token goes into an httpOnly cookie so no script can read it;
   * the short-lived access token goes in the body and is held in memory.
   */
  private respondWithSession(
    res: Response,
    user: SessionUser,
    tokens: IssuedTokens,
  ) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return {
      user,
      accessToken: tokens.accessToken,
      expiresInSec: tokens.expiresInSec,
    };
  }
}

function meta(req: Request): RequestMeta {
  return {
    device: req.get('user-agent') ?? 'Unknown device',
    ip: req.ip ?? '',
  };
}
