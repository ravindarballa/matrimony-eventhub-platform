import {
  UseInterceptors,
  UploadedFile,
  BadRequestException,
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
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MAX_PHOTO_BYTES } from '@eventhub/contracts';
import type {
  UpsertServiceRequest,
  VendorSearchQuery,
} from '@eventhub/contracts';

import { CurrentUser, Public, Roles } from '../../core/decorators.js';
import type { UploadedImage } from '../media/storage/file-storage.interface.js';
import { VendorsService } from './services/vendors.service.js';
import { ReviewsService } from './services/reviews.service.js';
import {
  BlockDatesDto,
  CalendarRangeDto,
  KycDecisionDto,
  OnboardVendorDto,
  SubmitKycDto,
  UpsertServiceDto,
  VendorSearchDto,
} from './dto/vendors.dto.js';
import { CreateReviewDto, VendorReplyDto } from './dto/reviews.dto.js';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly reviews: ReviewsService,
  ) {}

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

  /**
   * What each category has to show - count, a cover photo and a from-price, for
   * the browse grid. Public, and declared above `:id` so the literal segment is
   * not read as a vendor id.
   */
  @Get('category-counts')
  @Public()
  @ApiOperation({ summary: 'Count, cover photo and from-price for each category' })
  categoryCounts(@Query('city') city?: string) {
    return this.vendors.categoryTiles(city?.trim() || undefined);
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

  // ---------------------------------------------------------------- portfolio

  /**
   * Adds one photo to the signed-in vendor's portfolio.
   *
   * Held in memory: the cap is small and the storage driver wants a buffer, so
   * spooling to a temp file would only add something to clean up. multer
   * enforces the size while reading, so an oversized upload is cut off at the
   * socket rather than buffered whole and then rejected.
   */
  @Post('me/portfolio')
  @Roles('VENDOR_OWNER')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        caption: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Add a portfolio photo' })
  addPortfolioPhoto(
    @UploadedFile() file: UploadedImage | undefined,
    @Body('caption') caption: string | undefined,
    @CurrentUser('sub') ownerId: string,
  ) {
    if (!file) throw new BadRequestException('Attach a photo to upload.');
    return this.vendors.addPortfolioPhoto(ownerId, file, caption);
  }

  @Delete('me/portfolio/:photoId')
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Remove a portfolio photo' })
  removePortfolioPhoto(
    @Param('photoId') photoId: string,
    @CurrentUser('sub') ownerId: string,
  ) {
    return this.vendors.removePortfolioPhoto(ownerId, photoId);
  }

  @Post('me/portfolio/:photoId/cover')
  @HttpCode(HttpStatus.OK)
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Choose the photo shown on search cards' })
  setCoverPhoto(
    @Param('photoId') photoId: string,
    @CurrentUser('sub') ownerId: string,
  ) {
    return this.vendors.setCoverPhoto(ownerId, photoId);
  }

  @Post(':id/kyc-decision')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify or reject a vendor, with a reason' })
  decideKyc(@Param('id') id: string, @Body() dto: KycDecisionDto) {
    return this.vendors.decideKyc(id, dto);
  }

  // ---------------------------------------------------------------- reviews

  /**
   * A vendor's reviews. Public, because they are the reason to trust a
   * listing and hiding them behind a login would defeat the purpose.
   */
  @Get(':id/reviews')
  @Public()
  @ApiOperation({ summary: 'Reviews for a vendor, newest first' })
  listReviews(
    @Param('id') id: string,
    @Query('page') page?: string,
  ) {
    return this.reviews.listForVendor(id, Math.max(1, Number(page) || 1));
  }

  @Get(':id/reviews/summary')
  @Public()
  @ApiOperation({ summary: 'Average, histogram and per-aspect scores' })
  reviewSummary(@Param('id') id: string) {
    return this.reviews.summaryFor(id);
  }

  /**
   * Writes a review.
   *
   * It hangs off the vendors controller rather than bookings because a review
   * is read as part of a vendor and only ever written once per booking; the
   * booking is the credential, not the subject.
   */
  @Post('reviews')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Review a vendor for a completed booking' })
  writeReview(
    @Body() dto: CreateReviewDto,
    @CurrentUser('sub') customerId: string,
  ) {
    return this.reviews.create(customerId, dto);
  }

  /**
   * The caller's own review of a booking, or null if they have not written one.
   * Scoped to the caller, so it cannot be used to read anyone else's.
   */
  @Get('reviews/booking/:bookingId')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: "The caller's review of one booking, if any" })
  myReviewFor(
    @Param('bookingId') bookingId: string,
    @CurrentUser('sub') customerId: string,
  ) {
    return this.reviews.forBooking(customerId, bookingId);
  }

  /**
   * Answers a review. One reply per review, and the vendor cannot delete the
   * review itself - a right of reply is not a right of veto.
   */
  @Post('reviews/:reviewId/reply')
  @HttpCode(HttpStatus.OK)
  @Roles('VENDOR_OWNER')
  @ApiOperation({ summary: 'Reply publicly to a review' })
  replyToReview(
    @Param('reviewId') reviewId: string,
    @Body() dto: VendorReplyDto,
    @CurrentUser('sub') ownerId: string,
  ) {
    return this.reviews.reply(ownerId, reviewId, dto.body);
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
