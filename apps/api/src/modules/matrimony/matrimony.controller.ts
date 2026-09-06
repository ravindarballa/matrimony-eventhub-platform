import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MAX_PHOTO_BYTES } from '@eventhub/contracts';
import type {
  ProfileSearchQuery,
  UpsertProfileRequest,
} from '@eventhub/contracts';
import type { UploadedImage } from '../media/storage/file-storage.interface.js';

import { CurrentUser, Roles } from '../../core/decorators.js';
import { Throttle } from '../../core/throttle/throttle.guard.js';
import { ProfilesService } from './services/profiles.service.js';
import { ProfileSearchService } from './services/profile-search.service.js';
import { InterestsService } from './services/interests.service.js';
import { ChatService } from './services/chat.service.js';
import {
  BlockDto,
  InterestTabQuery,
  PartnerPreferencesDto,
  ProfileSearchDto,
  SendInterestDto,
  SendMessageDto,
  ShortlistDto,
  UpsertProfileDto,
} from './dto/matrimony.dto.js';

@ApiTags('matrimony')
@Controller('matrimony')
export class MatrimonyController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly search: ProfileSearchService,
    private readonly interests: InterestsService,
    private readonly chat: ChatService,
  ) {}

  // ------------------------------------------------------------------ profile

  @Get('profile/me')
  @ApiOperation({ summary: "The caller's own profile, unmasked" })
  findMine(@CurrentUser('sub') userId: string) {
    return this.profiles.findOwn(userId);
  }

  @Put('profile/me')
  @ApiOperation({ summary: 'Create or update your profile; sections merge' })
  upsert(@Body() dto: UpsertProfileDto, @CurrentUser('sub') userId: string) {
    return this.profiles.upsert(userId, dto as unknown as UpsertProfileRequest);
  }

  @Post('profile/me/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take the profile live once it is complete enough' })
  publish(@CurrentUser('sub') userId: string) {
    return this.profiles.publish(userId);
  }

  @Post('profile/me/hide')
  @HttpCode(HttpStatus.OK)
  hide(@CurrentUser('sub') userId: string) {
    return this.profiles.hide(userId);
  }

  @Post('profile/me/engaged')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark engaged; hands off to the wedding planner' })
  markEngaged(@CurrentUser('sub') userId: string) {
    return this.profiles.markEngaged(userId);
  }

  // ------------------------------------------------------------------- photos

  /**
   * Uploads one profile photo.
   *
   * Held in memory rather than spooled to a temp file: the size cap is 5 MB and
   * the storage driver wants a buffer anyway, so a disk round-trip would only
   * add a file to clean up. multer enforces the cap while reading, so an
   * oversized upload is cut off at the socket instead of being buffered whole
   * and rejected afterwards.
   */
  @Post('profile/me/photos')
  @Throttle({ limit: 20, ttlMs: 60 * 60 * 1000 })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Add a photo; starts PENDING until a moderator sees it' })
  addPhoto(
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser('sub') userId: string,
  ) {
    // No file at all is a malformed request rather than a validation failure
    // on a field, so it is caught here instead of in the service.
    if (!file) throw new BadRequestException('Attach a photo to upload.');
    return this.profiles.addPhoto(userId, file);
  }

  @Delete('profile/me/photos/:photoId')
  @ApiOperation({ summary: 'Remove one of your photos' })
  removePhoto(
    @Param('photoId') photoId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.profiles.removePhoto(userId, photoId);
  }

  @Post('profile/me/photos/:photoId/primary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Choose the photo shown on your card' })
  setPrimaryPhoto(
    @Param('photoId') photoId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.profiles.setPrimaryPhoto(userId, photoId);
  }
  @Get('preferences')
  getPreferences(@CurrentUser('sub') userId: string) {
    return this.profiles.getPreferences(userId);
  }

  @Put('preferences')
  savePreferences(
    @Body() dto: PartnerPreferencesDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.profiles.savePreferences(userId, dto);
  }

  // ------------------------------------------------------------------- search

  @Get('search')
  @Roles('SEEKER', 'ADMIN')
  @ApiOperation({ summary: 'Opposite-gender active profiles, blocks excluded' })
  async find(
    @Query() query: ProfileSearchDto,
    @CurrentUser('sub') userId: string,
  ) {
    const { items, total, page } = await this.search.search(
      userId,
      query as unknown as ProfileSearchQuery,
    );
    return { items, meta: { page, limit: query.limit ?? 20, total } };
  }

  // ---------------------------------------------------------------- interests

  @Get('interests')
  @ApiOperation({ summary: 'received | sent | accepted' })
  listInterests(
    @Query() query: InterestTabQuery,
    @CurrentUser('sub') userId: string,
  ) {
    return this.interests.list(userId, query.tab ?? 'received');
  }

  @Get('interests/quota')
  quota(@CurrentUser('sub') userId: string) {
    return this.interests.remainingQuota(userId);
  }

  @Post('interests')
  @Roles('SEEKER', 'ADMIN')
  // Sending interest is the action worth abusing, so it is rate limited well
  // below the daily quota that governs it.
  @Throttle({ limit: 20, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Send an interest; subject to the daily quota' })
  send(@Body() dto: SendInterestDto, @CurrentUser('sub') userId: string) {
    return this.interests.send(userId, dto);
  }

  @Post('interests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept; this is what unlocks contact details' })
  accept(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.interests.accept(userId, id);
  }

  @Post('interests/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.interests.decline(userId, id);
  }

  @Delete('interests/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw an interest you sent' })
  withdraw(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.interests.withdraw(userId, id);
  }

  // ---------------------------------------------------------------- shortlist

  @Get('shortlist')
  listShortlist(@CurrentUser('sub') userId: string) {
    return this.interests.listShortlist(userId);
  }

  @Post('shortlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a profile with a private note' })
  addShortlist(@Body() dto: ShortlistDto, @CurrentUser('sub') userId: string) {
    return this.interests.shortlist(userId, dto.targetProfileId, dto.note);
  }

  @Delete('shortlist/:profileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeShortlist(
    @Param('profileId') profileId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.interests.removeShortlist(userId, profileId);
  }

  // ---------------------------------------------------------------------- chat

  @Get('chat')
  @ApiOperation({ summary: 'Conversations, most recently active first' })
  listThreads(@CurrentUser('sub') userId: string) {
    return this.chat.listThreads(userId);
  }

  @Get('chat/unread-count')
  chatUnread(@CurrentUser('sub') userId: string) {
    return this.chat.unreadCount(userId);
  }

  @Get('chat/:threadId')
  @ApiOperation({ summary: 'One conversation; opening it marks it read' })
  messages(
    @Param('threadId') threadId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.chat.messagesIn(userId, threadId);
  }

  @Post('chat/:threadId')
  @Throttle({ limit: 60, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Send a message; this is what a plan pays for' })
  sendMessage(
    @Param('threadId') threadId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.chat.send(userId, threadId, dto.body);
  }

  // ------------------------------------------------------------------- safety

  @Post('blocks')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Block a profile; it disappears in both directions' })
  block(@Body() dto: BlockDto, @CurrentUser('sub') userId: string) {
    return this.interests.block(userId, dto.targetProfileId, dto.reason);
  }

  @Delete('blocks/:profileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(
    @Param('profileId') profileId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.interests.unblock(userId, profileId);
  }

  /**
   * Declared last: a literal path segment above would otherwise be swallowed by
   * this parameter route.
   */
  @Get('profile/:id')
  @ApiOperation({ summary: 'Another profile, masked by its privacy settings' })
  view(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.profiles.viewProfile(id, userId);
  }
}
