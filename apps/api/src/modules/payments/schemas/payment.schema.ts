import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { PaymentMilestone, PaymentStatus } from '@eventhub/contracts';

export type PaymentDocument = HydratedDocument<Payment>;

/**
 * One refund against this payment. Kept as a subdocument rather than its own
 * collection because a refund is never read without its payment, and because
 * the gateway's refund id is what makes replaying refund.processed harmless.
 */
@Schema({ _id: false })
export class PaymentRefund {
  @Prop({ required: true }) refundId!: string;
  @Prop({ required: true }) amount!: number;
  @Prop({ type: String, enum: ['processed', 'pending', 'failed'], required: true })
  status!: 'processed' | 'pending' | 'failed';
  @Prop({ required: true }) createdAt!: Date;
  @Prop() reason?: string;
}

export const PaymentRefundSchema = SchemaFactory.createForClass(PaymentRefund);

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  /**
   * What this payment is for.
   *
   * One collection carries both because the machinery that matters - the
   * idempotency key, the unique gateway ids, the webhook dedupe - is identical
   * either way, and duplicating it for subscriptions would mean two chances to
   * get the hard part wrong.
   */
  @Prop({ type: String, enum: ['BOOKING', 'SUBSCRIPTION'], default: 'BOOKING', index: true })
  purpose!: 'BOOKING' | 'SUBSCRIPTION';

  @Prop({
    type: Types.ObjectId,
    ref: 'Booking',
    index: true,
    required: function (this: { purpose?: string }) {
      return (this.purpose ?? 'BOOKING') === 'BOOKING';
    },
  })
  bookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Vendor',
    required: function (this: { purpose?: string }) {
      return (this.purpose ?? 'BOOKING') === 'BOOKING';
    },
  })
  vendorId?: Types.ObjectId;

  /**
   * Snapshotted from the booking at intent time so the split is computed from
   * the rate that was agreed, not whatever the config says on capture day.
   */
  @Prop({
    required: function (this: { purpose?: string }) {
      return (this.purpose ?? 'BOOKING') === 'BOOKING';
    },
  })
  commissionBps?: number;

  @Prop({
    type: String,
    enum: Object.values(PaymentMilestone),
    required: function (this: { purpose?: string }) {
      return (this.purpose ?? 'BOOKING') === 'BOOKING';
    },
  })
  milestone?: PaymentMilestone;

  /** Subscriptions only: which plan was bought. */
  @Prop({ type: String })
  planCode?: string;

  /** Subscriptions only: the tax charged on top of the plan price. */
  @Prop()
  gstAmount?: number;

  /** Integer paisa, computed server-side from the booking. */
  @Prop({ required: true })
  amount!: number;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.CREATED,
  })
  status!: PaymentStatus;

  @Prop({ required: true })
  gatewayOrderId!: string;

  /** Set when the gateway captures. Unique so a capture cannot be applied twice. */
  @Prop()
  gatewayPaymentId?: string;

  @Prop()
  method?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  failureReason?: string;

  @Prop({ default: 0 })
  refundedAmount!: number;

  @Prop({ type: [PaymentRefundSchema], default: [] })
  refunds!: PaymentRefund[];

  /**
   * Supplied by the client and unique. A retried request returns the original
   * payment rather than creating a second one - this is what makes retrying
   * a payment provably safe.
   */
  @Prop({ required: true })
  idempotencyKey!: string;

  @Prop({ required: true })
  expiresAt!: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ idempotencyKey: 1 }, { unique: true });
PaymentSchema.index({ gatewayOrderId: 1 }, { unique: true });
PaymentSchema.index({ gatewayPaymentId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ bookingId: 1, milestone: 1 });
PaymentSchema.index({ customerId: 1, purpose: 1, createdAt: -1 });
