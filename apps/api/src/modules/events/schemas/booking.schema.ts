import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  BookingStatus,
  VendorCategory,
  type CancellationTier,
} from '@eventhub/contracts';

export type BookingDocument = HydratedDocument<Booking>;

@Schema({ _id: false })
export class StatusChange {
  @Prop({ type: String }) from?: BookingStatus;
  @Prop({ type: String, required: true }) to!: BookingStatus;
  @Prop({ required: true }) at!: Date;
  @Prop({ required: true }) by!: string;
  @Prop() reason?: string;
}

@Schema({ timestamps: true, collection: 'bookings' })
export class Booking {
  @Prop({ type: Types.ObjectId, ref: 'Wedding', required: true, index: true })
  weddingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WeddingFunction' })
  functionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quote', required: true, unique: true })
  quoteId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(VendorCategory), required: true })
  category!: VendorCategory;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    required: true,
    default: BookingStatus.ACCEPTED,
  })
  status!: BookingStatus;

  @Prop({ required: true })
  eventDate!: Date;

  /** All money is integer paisa. Never a float. */
  @Prop({ required: true }) totalAmount!: number;
  @Prop({ required: true, default: 0 }) paidAmount!: number;
  @Prop({ required: true }) advanceAmount!: number;

  /**
   * Snapshotted at acceptance. A later change to platform commission or the
   * refund policy must not restate an agreement that was already struck.
   */
  @Prop({ required: true })
  commissionBps!: number;

  @Prop({ type: Array, required: true })
  cancellationTiers!: CancellationTier[];

  /** The slot this booking holds, so releasing it on cancel is unambiguous. */
  @Prop({ type: Types.ObjectId, ref: 'VendorAvailability' })
  availabilityId?: Types.ObjectId;

  @Prop({ type: [StatusChange], default: [] })
  statusHistory!: StatusChange[];

  /** Set when ACCEPTED; the slot is released if the advance is unpaid by then. */
  @Prop()
  advanceDueAt?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop()
  cancelledBy?: string;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

BookingSchema.index({ customerId: 1, status: 1 });
BookingSchema.index({ vendorId: 1, eventDate: 1 });
BookingSchema.index({ status: 1, eventDate: 1 });
// Drives the sweep that expires ACCEPTED bookings whose advance never arrived.
BookingSchema.index({ status: 1, advanceDueAt: 1 });
