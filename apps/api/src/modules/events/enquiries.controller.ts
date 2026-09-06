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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Matches,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  EnquiryVendorStatus,
  FunctionType,
  INDIAN_MOBILE_REGEX,
  MAX_ENQUIRY_VENDORS,
  VendorCategory,
  type CreateEnquiryRequest,
  type CreateQuoteRequest,
  type CreateWeddingRequest,
  type GuestEnquiryRequest,
  type GuestEnquiryResponse,
} from '@eventhub/contracts';

import type { Request, Response } from 'express';

import { CurrentUser, Public, Roles } from '../../core/decorators.js';
import { Throttle } from '../../core/throttle/throttle.guard.js';
import { setRefreshCookie } from '../auth/refresh-cookie.js';
import { EnquiriesService } from './services/enquiries.service.js';

class CreateWeddingDto {
  @IsString() @MinLength(1) @MaxLength(80) brideName!: string;
  @IsString() @MinLength(1) @MaxLength(80) groomName!: string;
  @IsISO8601() primaryDate!: string;
  @IsString() @MinLength(2) @MaxLength(80) city!: string;
  @IsInt() @Min(1) guestEstimate!: number;
  /** Integer paisa. */
  @IsInt() @Min(0) budgetTotal!: number;
}

class CreateWeddingFunctionDto {
  @IsEnum(FunctionType) type!: FunctionType;
  @IsISO8601() date!: string;
  @IsInt() @Min(1) guestCount!: number;
}

/**
 * A guest enquiry carries the identity fields as well, because the account does
 * not exist yet when this is submitted.
 */
class GuestEnquiryDto {
  @IsString() @MinLength(2) @MaxLength(80) fullName!: string;
  @Matches(INDIAN_MOBILE_REGEX, { message: 'Enter a valid mobile number' })
  mobile!: string;
  @IsString() otpChallengeId!: string;
  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' }) otpCode!: string;

  @IsString() @MinLength(2) @MaxLength(80) city!: string;
  @IsEnum(VendorCategory) category!: VendorCategory;
  @IsEnum(FunctionType) functionType!: FunctionType;
  @IsISO8601() functionDate!: string;
  @IsInt() @Min(1) guestCount!: number;

  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENQUIRY_VENDORS)
  @IsMongoId({ each: true })
  vendorIds!: string[];
}

class CreateEnquiryDto {
  @IsMongoId() weddingId!: string;
  @IsEnum(VendorCategory) category!: VendorCategory;
  @IsEnum(FunctionType) functionType!: FunctionType;
  @IsISO8601() functionDate!: string;
  @IsInt() @Min(1) guestCount!: number;

  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENQUIRY_VENDORS)
  @IsMongoId({ each: true })
  vendorIds!: string[];
}

class QuoteLineDto {
  @IsString() @MinLength(2) @MaxLength(200) description!: string;
  @IsInt() @IsPositive() quantity!: number;
  /** Integer paisa. */
  @IsInt() @IsPositive() unitPrice!: number;
}

class CreateQuoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lineItems!: QuoteLineDto[];

  @IsInt() @Min(10) advancePercent!: number;
  @IsInt() @Min(1) validForDays!: number;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class InboxQuery {
  @IsOptional() @IsEnum(EnquiryVendorStatus) status?: EnquiryVendorStatus;
}

/**
 * The middle of the booking funnel: a wedding, an enquiry fanned out to
 * vendors, and the quotes that come back. Accepting one of those quotes is
 * BookingsController's job, which is where the date gets locked.
 */
@ApiTags('events')
@Controller()
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  @Post('weddings')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Create the wedding that bookings hang off' })
  createWedding(@Body() dto: CreateWeddingDto, @CurrentUser('sub') userId: string) {
    return this.enquiries.createWedding(userId, dto as CreateWeddingRequest);
  }

  @Get('weddings')
  @ApiOperation({ summary: "The caller's weddings" })
  listWeddings(@CurrentUser('sub') userId: string) {
    return this.enquiries.listWeddings(userId);
  }

  @Post('weddings/:id/functions')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Add a ceremony, with its own date and guest count' })
  addFunction(
    @Param('id') id: string,
    @Body() dto: CreateWeddingFunctionDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.enquiries.addFunction(id, userId, dto);
  }

  @Get('weddings/:id/functions')
  listFunctions(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.enquiries.listFunctions(id, userId);
  }

  @Delete('weddings/:id/functions/:functionId')
  @Roles('CUSTOMER')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFunction(
    @Param('id') id: string,
    @Param('functionId') functionId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.enquiries.removeFunction(id, functionId, userId);
  }

  /**
   * The open front door: an enquiry from someone with no account.
   *
   * Public by necessity - the caller has no token yet, and the one-time code is
   * what authenticates them. The response carries a session, so the browser is
   * signed in by the time the quotes start arriving.
   */
  @Post('enquiries/guest')
  @Public()
  @Throttle({ limit: 5, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Enquire without an account; creates one silently' })
  async createAsGuest(
    @Body() dto: GuestEnquiryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GuestEnquiryResponse> {
    const { enquiry, user, tokens } = await this.enquiries.createAsGuest(
      dto as unknown as GuestEnquiryRequest,
      {
        device: req.headers['user-agent'],
        ip: req.ip,
      },
    );

    // The same httpOnly cookie an ordinary sign-in sets, written through the
    // shared helper so this path cannot drift from /auth/refresh.
    setRefreshCookie(res, tokens.refreshToken);

    return {
      enquiry,
      user,
      accessToken: tokens.accessToken,
      expiresInSec: tokens.expiresInSec,
    };
  }

  @Post('enquiries')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Fan one enquiry out to up to five vendors' })
  create(@Body() dto: CreateEnquiryDto, @CurrentUser('sub') userId: string) {
    return this.enquiries.create(userId, dto as CreateEnquiryRequest);
  }

  @Get('enquiries')
  @Roles('CUSTOMER')
  listMine(@CurrentUser('sub') userId: string) {
    return this.enquiries.listForCustomer(userId);
  }

  @Get('enquiries/inbox')
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  @ApiOperation({ summary: 'The vendor inbox, most urgent SLA first' })
  inbox(@Query() query: InboxQuery, @CurrentUser('sub') userId: string) {
    return this.enquiries.inboxForVendor(userId, query.status);
  }

  @Get('enquiries/:id')
  @Roles('CUSTOMER')
  findOne(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.enquiries.findForCustomer(id, userId);
  }

  @Get('enquiries/:id/quotes')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Every quote against this enquiry, cheapest first' })
  quotes(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.enquiries.quotesForEnquiry(id, userId);
  }

  @Post('enquiries/:id/quotes')
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Answer an enquiry; every total is recomputed server-side' })
  quote(
    @Param('id') id: string,
    @Body() dto: CreateQuoteDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.enquiries.quote(userId, id, dto as CreateQuoteRequest);
  }

  @Post('enquiries/:id/decline')
  @Roles('VENDOR_OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.enquiries.decline(userId, id);
  }
}
