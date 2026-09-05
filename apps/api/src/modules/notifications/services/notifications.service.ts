import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  NotificationChannel,
  NotificationCriticality,
  type NotificationDto,
  type NotificationPreferencesDto,
} from '@eventhub/contracts';

import {
  Notification,
  NotificationPreference,
  type NotificationDocument,
  type NotificationPreferenceDocument,
} from '../schemas/notification.schema.js';

export interface SendParams {
  userId: string | Types.ObjectId;
  type: string;
  title: string;
  body: string;
  link?: string;
  criticality?: NotificationCriticality;
  channels?: NotificationChannel[];
  data?: Record<string, unknown>;
}

/**
 * The one way a message reaches a person.
 *
 * Two rules live here and nowhere else. A TRANSACTIONAL message ignores
 * preferences and quiet hours entirely - somebody whose payment just failed
 * needs to know at 2am, and an opt-out that swallows it is a support incident,
 * not a courtesy. Everything else respects both.
 *
 * Delivery outside the platform is stubbed: SMS, email and push are logged
 * rather than sent, so the whole notification path can be built and tested
 * before any provider account exists. The record is written either way, because
 * "did we tell them?" is a question support has to answer.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<NotificationDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferences: Model<NotificationPreferenceDocument>,
  ) {}

  /** Fans one message out across the channels it is allowed to use. */
  async send(params: SendParams): Promise<void> {
    const userId =
      typeof params.userId === 'string'
        ? new Types.ObjectId(params.userId)
        : params.userId;

    const criticality = params.criticality ?? NotificationCriticality.STANDARD;
    const channels = params.channels ?? [NotificationChannel.IN_APP];
    const prefs = await this.preferencesFor(userId);

    for (const channel of channels) {
      const suppression = this.suppressionFor(channel, criticality, prefs);

      const created = await this.notifications.create({
        userId,
        type: params.type,
        channel,
        criticality,
        title: params.title,
        body: params.body,
        link: params.link,
        data: params.data,
        status: suppression ? 'SUPPRESSED' : 'PENDING',
        suppressionReason: suppression,
      });

      if (suppression) {
        this.logger.debug(
          `Suppressed ${params.type} on ${channel} for ${userId.toString()}: ${suppression}`,
        );
        continue;
      }

      await this.deliver(created);
    }
  }

  /**
   * Why this message must not go out on this channel, or undefined if it may.
   * Transactional messages short-circuit before any of it.
   */
  private suppressionFor(
    channel: NotificationChannel,
    criticality: NotificationCriticality,
    prefs: NotificationPreferenceDocument,
  ): string | undefined {
    if (criticality === NotificationCriticality.TRANSACTIONAL) return undefined;

    const enabled: Record<NotificationChannel, boolean> = {
      IN_APP: prefs.inApp,
      PUSH: prefs.push,
      SMS: prefs.sms,
      EMAIL: prefs.email,
      WHATSAPP: prefs.whatsapp,
    };
    if (!enabled[channel]) return `${channel.toLowerCase()} turned off`;

    if (criticality === NotificationCriticality.MARKETING && !prefs.marketing) {
      return 'not opted in to marketing';
    }

    // The in-app inbox is pull, not push: it never wakes anyone, so quiet hours
    // do not apply to it.
    if (channel !== NotificationChannel.IN_APP && this.inQuietHours(prefs)) {
      return 'quiet hours';
    }

    return undefined;
  }

  /** Handles the usual case and the wrap-around one (22:00 to 07:00). */
  private inQuietHours(prefs: NotificationPreferenceDocument): boolean {
    const hour = new Date().getHours();
    const { quietFromHour: from, quietToHour: to } = prefs;
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  /**
   * Hands the message to its channel.
   *
   * IN_APP is delivered by the row existing - the inbox reads these rows. The
   * rest are logged until a provider is wired in; swapping the log for MSG91 or
   * SES is a change here and nowhere else.
   */
  private async deliver(notification: NotificationDocument): Promise<void> {
    try {
      if (notification.channel !== NotificationChannel.IN_APP) {
        this.logger.log(
          `[${notification.channel}] -> ${notification.userId.toString()}: ${notification.title}`,
        );
      }
      notification.status = 'SENT';
      notification.sentAt = new Date();
      await notification.save();
    } catch (e) {
      notification.status = 'FAILED';
      notification.failureReason = (e as Error).message;
      await notification.save();
      // A failed notification must never fail the thing that triggered it.
      this.logger.error(`Delivery failed for ${notification.id as string}`, e as Error);
    }
  }

  // -------------------------------------------------------------------- inbox

  async list(userId: string, unreadOnly = false): Promise<NotificationDto[]> {
    if (!Types.ObjectId.isValid(userId)) return [];

    const rows = await this.notifications
      .find({
        userId: new Types.ObjectId(userId),
        channel: NotificationChannel.IN_APP,
        status: { $ne: 'SUPPRESSED' },
        ...(unreadOnly ? { readAt: { $exists: false } } : {}),
      })
      .sort({ createdAt: -1 })
      .limit(50);

    return rows.map((n) => this.toDto(n));
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    if (!Types.ObjectId.isValid(userId)) return { count: 0 };
    return {
      count: await this.notifications.countDocuments({
        userId: new Types.ObjectId(userId),
        channel: NotificationChannel.IN_APP,
        status: { $ne: 'SUPPRESSED' },
        readAt: { $exists: false },
      }),
    };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    if (!Types.ObjectId.isValid(notificationId)) throw new NotFoundException();
    // Ownership is part of the query, so one member cannot read another's.
    const result = await this.notifications.updateOne(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      { $set: { readAt: new Date() } },
    );
    if (result.matchedCount === 0) throw new NotFoundException();
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications.updateMany(
      { userId: new Types.ObjectId(userId), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    return { updated: result.modifiedCount };
  }

  // -------------------------------------------------------------- preferences

  async getPreferences(userId: string): Promise<NotificationPreferencesDto> {
    return this.toPreferencesDto(
      await this.preferencesFor(new Types.ObjectId(userId)),
    );
  }

  async savePreferences(
    userId: string,
    dto: Partial<NotificationPreferencesDto>,
  ): Promise<NotificationPreferencesDto> {
    const saved = await this.preferences.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      { $set: dto },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.toPreferencesDto(saved!);
  }

  /** Defaults are generous but not created until someone changes them. */
  private async preferencesFor(
    userId: Types.ObjectId,
  ): Promise<NotificationPreferenceDocument> {
    const found = await this.preferences.findOne({ userId });
    return found ?? new this.preferences({ userId });
  }

  private toDto(n: NotificationDocument): NotificationDto {
    return {
      id: n.id as string,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      criticality: n.criticality,
      read: Boolean(n.readAt),
      createdAt: (n as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }

  private toPreferencesDto(
    p: NotificationPreferenceDocument,
  ): NotificationPreferencesDto {
    return {
      inApp: p.inApp,
      push: p.push,
      sms: p.sms,
      email: p.email,
      whatsapp: p.whatsapp,
      marketing: p.marketing,
      quietFromHour: p.quietFromHour,
      quietToHour: p.quietToHour,
    };
  }
}
