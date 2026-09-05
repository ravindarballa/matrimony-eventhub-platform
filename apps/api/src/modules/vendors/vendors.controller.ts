import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  UpsertServiceRequest,
  VendorSearchQuery,
} from '@eventhub/contracts';

import { CurrentUser, Public, Roles } from '../../core/decorators.js';
import { VendorsService } from './services/vendors.service.js';
import {
  BlockDatesDto,
  CalendarRangeDto,
  KycDecisionDto,
  OnboardVendorDto,
  SubmitKycDto,
  UpsertServiceDto,
  VendorSearchDto,
} from './dto/vendors.dto.js';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  /**
   * Search is public: browsing the supply is how a customer decides whether the
   * platform is worth signing up for. Nothing here exposes anything a vendor
   * has not chosen to publish - bank details live behind `select: false`.
   */
  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Find bookable vendors; a date excludes taken calendars' })
  async search(@Query() query: VendorSearchDto) {
    // The DTO carries plain numbers; money crosses into branded Paisa here,
    // at the one boundary where an untyped request becomes typed domain input.
    const { items, total, page } = await this.vendors.search(
      query as VendorSearchQuery,
    );
    // The interceptor lifts { items, meta } into { data, meta }.
    return { items, meta: { page, limit: query.limit ?? 20, total } };
  }

  @Get('me')
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  @ApiOperation({ summary: "The caller's own vendor organisation" })
  findMine(@CurrentUser('sub') userId: string) {
    return this.vendors.findMine(userId);
  }

  @Get('kyc/pending')
  @Roles('ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'The KYC review queue, oldest first' })
  pendingKyc() {
    return this.vendors.pendingKyc();
  }

  @Post()
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Create the vendor listing for the signed-in owner' })
  onboard(@Body() dto: OnboardVendorDto, @CurrentUser('sub') userId: string) {
    return this.vendors.onboard(userId, dto);
  }

  @Post('me/kyc')
  @Roles('VENDOR_OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit KYC for review' })
  submitKyc(@Body() dto: SubmitKycDto, @CurrentUser('sub') userId: string) {
    return this.vendors.submitKyc(userId, dto);
  }

  @Post('me/services')
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Add a package to the catalogue' })
  addService(@Body() dto: UpsertServiceDto, @CurrentUser('sub') userId: string) {
    return this.vendors.addService(userId, dto as UpsertServiceRequest);
  }

  @Patch('me/services/:serviceId')
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Edit or deactivate one package' })
  updateService(
    @Param('serviceId') serviceId: string,
    @Body() dto: UpsertServiceDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.vendors.updateService(userId, serviceId, dto as UpsertServiceRequest);
  }

  @Get('me/calendar')
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  @ApiOperation({ summary: 'Held, booked and blocked days in a date range' })
  calendar(
    @Query() query: CalendarRangeDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.vendors.calendar(userId, query.from, query.to);
  }

  @Post('me/calendar/block')
  @Roles('VENDOR_OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark dates unavailable; booked dates are refused' })
  blockDates(@Body() dto: BlockDatesDto, @CurrentUser('sub') userId: string) {
    return this.vendors.blockDates(userId, dto.dates, dto.reason);
  }

  @Delete('me/calendar/block/:date')
  @Roles('VENDOR_OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblockDate(@Param('date') date: string, @CurrentUser('sub') userId: string) {
    return this.vendors.unblockDate(userId, date);
  }

  @Post(':id/kyc-decision')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify or reject a vendor, with a reason' })
  decideKyc(@Param('id') id: string, @Body() dto: KycDecisionDto) {
    return this.vendors.decideKyc(id, dto);
  }

  @Get(':id/services')
  @Public()
  listServices(@Param('id') id: string) {
    return this.vendors.listServices(id);
  }

  @Get(':id')
  @Public()
  findOne(@Param('id') id: string) {
    return this.vendors.findOne(id);
  }
}
