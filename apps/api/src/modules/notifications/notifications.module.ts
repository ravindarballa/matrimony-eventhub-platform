import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

import { CurrentUser } from '../../core/decorators.js';
import { NotificationsService } from './services/notifications.service.js';
import { NotificationListeners } from './services/notification-listeners.js';
import {
  Notification,
  NotificationPreference,
  NotificationPreferenceSchema,
  NotificationSchema,
} from './schemas/notification.schema.js';

class InboxQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

class PreferencesDto {
  @IsOptional() @IsBoolean() inApp?: boolean;
  @IsOptional() @IsBoolean() push?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() whatsapp?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(23) quietFromHour?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietToHour?: number;
}

@ApiTags('notifications')
@Controller('notifications')
class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'The in-app inbox, newest first' })
  list(@Query() query: InboxQuery, @CurrentUser('sub') userId: string) {
    return this.notifications.list(userId, query.unreadOnly ?? false);
  }

  /** Polled by the bell in every shell, so it stays a counting query. */
  @Get('unread-count')
  unreadCount(@CurrentUser('sub') userId: string) {
    return this.notifications.unreadCount(userId);
  }

  @Get('preferences')
  getPreferences(@CurrentUser('sub') userId: string) {
    return this.notifications.getPreferences(userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Channels and quiet hours; transactional ignores both' })
  savePreferences(
    @Body() dto: PreferencesDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.notifications.savePreferences(userId, dto);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser('sub') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.notifications.markRead(userId, id);
  }
}

/**
 * Notifications.
 *
 * The module has no dependencies on any other feature module by design: it
 * listens for domain events and resolves the few ids it needs directly. That
 * way adding a notification never means editing the module that caused it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationPreference.name, schema: NotificationPreferenceSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListeners],
  exports: [NotificationsService],
})
export class NotificationsModule {}
