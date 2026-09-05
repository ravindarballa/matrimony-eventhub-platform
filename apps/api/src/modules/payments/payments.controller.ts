import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode, type Paisa } from '@eventhub/contracts';

import { CurrentUser, Public, Roles } from '../../core/decorators.js';
import { SkipThrottle, Throttle } from '../../core/throttle/throttle.guard.js';
import { CreateIntentDto, RefundDto } from './dto/payments.dto.js';
import { LedgerService } from './services/ledger.service.js';
import { PaymentsService } from './services/payments.service.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * The Idempotency-Key header is required rather than optional: without one, a
   * retried request after a timeout would open a second gateway order for the
   * same money, and the client cannot tell the two situations apart.
   */
  @Post('intents')
  @Roles('CUSTOMER')
  @Throttle({ limit: 10, ttlMs: 60_000 })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A fresh unique value per checkout attempt',
  })
  @ApiOperation({ summary: 'Open a checkout for one milestone of a booking' })
  createIntent(
    @Body() dto: CreateIntentDto,
    @CurrentUser('sub') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'An Idempotency-Key header of 8 to 128 characters is required.',
      });
    }
    return this.payments.createIntent(
      dto.bookingId,
      dto.milestone,
      userId,
      idempotencyKey,
    );
  }

  /**
   * The gateway's callback. Public because the gateway holds no session - the
   * HMAC over the raw body is the authentication, and it is verified before the
   * body is parsed. Throttling is skipped so a legitimate burst of retries is
   * never rejected; the signature check is what bounds the work an attacker can
   * cause here.
   */
  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      // Means the app was created without rawBody: true - a misconfiguration,
      // not a client error, and one that would silently break verification.
      throw new BadRequestException({
        code: ErrorCode.PAY_BAD_SIGNATURE,
        message: 'Raw request body unavailable.',
      });
    }
    return this.payments.handleWebhook(rawBody, signature ?? '');
  }

  /**
   * Local development only, and only against the fake gateway - the service
   * refuses otherwise. It stands in for the hosted checkout page a real gateway
   * would provide.
   */
  @Post(':id/simulate-capture')
  @Roles('CUSTOMER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fake gateway only: complete a checkout as if paid' })
  simulateCapture(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.payments.simulateCapture(id, userId);
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'Every payment attempt against a booking' })
  listForBooking(
    @Param('bookingId') bookingId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.payments.listForBooking(bookingId, userId);
  }

  @Get('booking/:bookingId/schedule')
  @ApiOperation({ summary: 'What is owed on this booking and when' })
  schedule(
    @Param('bookingId') bookingId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.payments.schedule(bookingId, userId);
  }

  @Get('booking/:bookingId/ledger')
  @Roles('ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'The double-entry lines behind a booking' })
  ledgerForBooking(@Param('bookingId') bookingId: string) {
    return this.ledger.forBooking(bookingId);
  }

  /**
   * Manual refunds are staff-only. The customer-initiated path is cancelling
   * the booking, which refunds by policy through the domain event rather than
   * letting anyone name their own amount.
   */
  @Post(':id/refund')
  @Roles('ADMIN', 'SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund a captured payment, in whole or in part' })
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.payments.refund(id, dto.amount as Paisa | undefined, dto.reason);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.payments.findOwned(id, userId);
  }
}
