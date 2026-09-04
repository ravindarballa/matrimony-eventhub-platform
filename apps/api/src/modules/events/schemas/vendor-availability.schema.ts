import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { AvailabilityStatus } from '@eventhub/contracts';

export type VendorAvailabilityDocument = HydratedDocument<VendorAvailability>;

/**
 * One document per vendor per occupied date. This collection is the reason
 * double-booking is impossible rather than merely unlikely.
 */
@Schema({ timestamps: true, collection: 'vendor_availability' })
export class VendorAvailability {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId!: Types.ObjectId;

  /** Normalised to UTC midnight so a date is one exact value, not a range. */
  @Prop({ required: true })
  date!: Date;

  @Prop({
    type: String,
    enum: Object.values(AvailabilityStatus),
    required: true,
  })
  status!: AvailabilityStatus;

  @Prop({ type: Types.ObjectId, ref: 'Booking' })
  bookingId?: Types.ObjectId;

  /** For manual blocks: "offline booking", "travel", "leave". */
  @Prop()
  reason?: string;
}

export const VendorAvailabilitySchema =
  SchemaFactory.createForClass(VendorAvailability);

/**
 * THE critical index.
 *
 * A unique partial index on (vendorId, date), restricted to the statuses that
 * actually occupy the date, means two concurrent quote acceptances cannot both
 * insert - the loser gets E11000, which the service maps to 409 EVT_SLOT_TAKEN.
 *
 * An application-level "check then insert" cannot provide this: between the read
 * and the write, the other transaction commits. Only the storage engine can
 * arbitrate, so the guarantee has to live here.
 *
 * The partial filter is what lets a released date (CANCELLED -> AVAILABLE) be
 * re-booked: rows outside HELD/BOOKED are not in the index at all.
 */
VendorAvailabilitySchema.index(
  { vendorId: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [AvailabilityStatus.HELD, AvailabilityStatus.BOOKED] },
    },
    name: 'vendor_date_exclusive',
  },
);

// Supports the month-view calendar query.
VendorAvailabilitySchema.index({ vendorId: 1, date: 1, status: 1 });
