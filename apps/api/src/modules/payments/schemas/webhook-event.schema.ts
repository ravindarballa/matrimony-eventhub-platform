import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type WebhookEventDocument = HydratedDocument<WebhookEvent>;

/**
 * The record of gateway deliveries we have already acted on.
 *
 * Gateways retry: the same payment.captured can arrive three times. Without
 * this the booking would be credited three times. The unique index on
 * (gateway, eventId) is the actual guarantee - the service claims a row before
 * doing any work, and a concurrent duplicate loses the insert.
 */
@Schema({ timestamps: true, collection: 'webhook_events' })
export class WebhookEvent {
  @Prop({ required: true })
  gateway!: string;

  /** The provider's own event id. */
  @Prop({ required: true })
  eventId!: string;

  @Prop({ required: true })
  event!: string;

  @Prop()
  gatewayOrderId?: string;

  /** Set once processing succeeded; a claimed-but-unprocessed row is a failure. */
  @Prop()
  processedAt?: Date;

  /** Kept for support to inspect, and expired by TTL so it cannot grow forever. */
  @Prop({ type: Object })
  payload?: Record<string, unknown>;
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);

WebhookEventSchema.index({ gateway: 1, eventId: 1 }, { unique: true });
// 90 days is comfortably longer than any gateway's retry window.
WebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });
