import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Post,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlanCode } from '@eventhub/contracts';

import { CurrentUser, Public, Roles } from '../../core/decorators.js';
import { EntitlementsService } from './services/entitlements.service.js';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema.js';

class GrantDto {
  @IsMongoId() userId!: string;
  @IsEnum(PlanCode) plan!: PlanCode;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@ApiTags('subscriptions')
@Controller('subscriptions')
class SubscriptionsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  /** The plan table. Public, because a price nobody can see sells nothing. */
  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'Available plans and what each unlocks' })
  plans() {
    return this.entitlements.plans();
  }

  @Get('me')
  @ApiOperation({ summary: 'What the caller may do, and what is left today' })
  me(@CurrentUser('sub') userId: string) {
    return this.entitlements.snapshot(userId);
  }

  /**
   * Staff grant, for support cases and for testing before checkout exists.
   * Deliberately not something a member can call for themselves.
   */
  @Post('grant')
  @Roles('ADMIN', 'SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Give a member a plan without a payment' })
  grant(@Body() dto: GrantDto) {
    return this.entitlements.grant(dto.userId, dto.plan, dto.reason);
  }
}

/**
 * Subscriptions and entitlements.
 *
 * Matrimony asks this module what a member may do; nothing here knows what a
 * profile or an interest is. That keeps the paywall a single, movable line
 * rather than a rule copied into every feature that charges for something.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [SubscriptionsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class SubscriptionsModule {}
