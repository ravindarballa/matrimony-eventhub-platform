import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { PlanCode, SubscriptionStatus } from '@eventhub/contracts';

export type SubscriptionDocument = HydratedDocument<Subscription>;

/**
 * One paid period.
 *
 * Rows are never mutated into a new period - buying again writes a new row, so
 * the history of what someone paid for and when stays intact. That matters the
 * first time somebody disputes a charge.
 *
 * The schema lives in its own file rather than beside the module, because the
 * service imports it and the module imports the service: keeping them together
 * makes a cycle that fails at load time.
 */
@Schema({ timestamps: true, collection: 'subscriptions' })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(PlanCode), required: true })
  plan!: PlanCode;

  @Prop({
    type: String,
    enum: Object.values(SubscriptionStatus),
    default: SubscriptionStatus.ACTIVE,
  })
  status!: SubscriptionStatus;

  @Prop({ required: true }) startedAt!: Date;

  /** Access lasts until this instant. Expiry is read, never swept. */
  @Prop({ required: true }) currentPeriodEnd!: Date;

  @Prop({ type: String, enum: ['PAID', 'COMPLIMENTARY'], default: 'PAID' })
  source!: 'PAID' | 'COMPLIMENTARY';

  /** The payment that bought it. Absent for complimentary grants. */
  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  /** Why staff granted it, when they did. */
  @Prop({ trim: true, maxlength: 300 })
  note?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// The entitlement lookup: the newest still-running period for one member.
SubscriptionSchema.index({ userId: 1, status: 1, currentPeriodEnd: -1 });
