import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { BookingStatus } from '@eventhub/contracts';

import { CurrentUser, Roles, type JwtPayload } from '../../core/decorators.js';
import { BookingsService } from './services/bookings.service.js';

class ListBookingsQuery {
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}

class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('events')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'The bookings belonging to the signed-in customer' })
  list(@Query() query: ListBookingsQuery, @CurrentUser() user: JwtPayload) {
    return this.bookings.listMine(user.sub, user.roles, query.status);
  }

  @Post('quotes/:quoteId/accept')
  @Roles('CUSTOMER')
  @ApiOperation({
    summary: 'Accept a quote, locking the vendor date transactionally',
  })
  accept(@Param('quoteId') quoteId: string, @CurrentUser('sub') userId: string) {
    return this.bookings.acceptQuote(quoteId, userId);
  }

  @Get(':id/refund-preview')
  @ApiOperation({
    summary: 'What the customer would receive - computed, never committed',
  })
  refundPreview(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.bookings.refundPreview(id, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a booking and release the date' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookings.cancel(id, user.sub, user.roles, dto.reason);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const booking = await this.bookings.findOwned(id, user.sub);
    return this.bookings.toDto(booking, user.roles);
  }
}
