import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { NotificationChannel, NotificationCriticality } from '@eventhub/contracts';

export type NotificationDocument = HydratedDocument<Notification>;

/**
 * One message to one person.
 *
 * Stored even for channels that leave the platform (SMS, email, push), because
 * "did we tell them?" is a question support has to answer, and the honest
 * answer needs a record of what was sent, when, and whether it failed.
 */
@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** A stable key like 'booking.confirmed'. Never shown to the user. */
  @Prop({ required: true })
  type!: string;

  @Prop({
    type: String,
    enum: Object.values(NotificationChannel),
    required: true,
  })
  channel!: NotificationChannel;

  @Prop({
    type: String,
    enum: Object.values(NotificationCriticality),
    default: NotificationCriticality.STANDARD,
  })
  criticality!: NotificationCriticality;

  @Prop({ required: true, trim: true }) title!: string;
  @Prop({ required: true, trim: true }) body!: string;

  /** Where tapping it should go, e.g. /customer/bookings/123. */
  @Prop({ trim: true })
  link?: string;

  @Prop({ type: Object })
  data?: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['PENDING', 'SENT', 'FAILED', 'SUPPRESSED'],
    default: 'PENDING',
  })
  status!: 'PENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED';

  /** Why a message was not sent - an opt-out, or quiet hours. */
  @Prop()
  suppressionReason?: string;

  @Prop() sentAt?: Date;
  @Prop() readAt?: Date;
  @Prop() failureReason?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// The in-app inbox query: newest first, unread first when filtered.
NotificationSchema.index({ userId: 1, channel: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });
// Ninety days is long enough for support to answer "did we tell them?".
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

// ---------------------------------------------------------------- preferences

export type NotificationPreferenceDocument =
  HydratedDocument<NotificationPreference>;

/**
 * What a person has agreed to receive.
 *
 * Only STANDARD and MARKETING messages consult this. A TRANSACTIONAL message -
 * a payment failure, a booking cancellation - is sent regardless, because a
 * platform that lets someone opt out of "your payment failed" is not doing them
 * a kindness.
 */
@Schema({ timestamps: true, collection: 'notification_preferences' })
export class NotificationPreference {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ default: true }) inApp!: boolean;
  @Prop({ default: true }) push!: boolean;
  @Prop({ default: true }) sms!: boolean;
  @Prop({ default: true }) email!: boolean;
  @Prop({ default: false }) whatsapp!: boolean;

  /** Marketing is opt-in, everything else opt-out. */
  @Prop({ default: false }) marketing!: boolean;

  /** 24-hour local clock. Quiet hours never delay a transactional message. */
  @Prop({ min: 0, max: 23, default: 22 }) quietFromHour!: number;
  @Prop({ min: 0, max: 23, default: 7 }) quietToHour!: number;
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreference,
);

NotificationPreferenceSchema.index({ userId: 1 }, { unique: true });
