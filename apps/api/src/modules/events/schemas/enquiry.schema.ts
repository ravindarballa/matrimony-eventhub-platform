import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  EnquiryVendorStatus,
  FunctionType,
  VendorCategory,
} from '@eventhub/contracts';

export type EnquiryDocument = HydratedDocument<Enquiry>;

/**
 * One vendor's leg of a fanned-out enquiry.
 *
 * Embedded rather than a separate collection because a leg is never read
 * without its enquiry, and because fanning out to five vendors must be one
 * atomic write - a partially fanned-out enquiry would show the customer a
 * vendor who was never actually asked.
 */
@Schema({ _id: false })
export class EnquiryVendor {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId!: Types.ObjectId;

  /** Snapshotted so the customer's list reads correctly if a vendor renames. */
  @Prop({ required: true })
  businessName!: string;

  @Prop({
    type: String,
    enum: Object.values(EnquiryVendorStatus),
    default: EnquiryVendorStatus.SENT,
  })
  status!: EnquiryVendorStatus;

  @Prop({ type: Types.ObjectId, ref: 'Quote' })
  quoteId?: Types.ObjectId;

  @Prop()
  respondedAt?: Date;
}

export const EnquiryVendorSchema = SchemaFactory.createForClass(EnquiryVendor);

@Schema({ timestamps: true, collection: 'enquiries' })
export class Enquiry {
  @Prop({ type: Types.ObjectId, ref: 'Wedding', required: true, index: true })
  weddingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(VendorCategory), required: true })
  category!: VendorCategory;

  @Prop({ type: String, enum: Object.values(FunctionType), required: true })
  functionType!: FunctionType;

  /** Stored at UTC midnight, like every other date the calendar compares. */
  @Prop({ required: true })
  functionDate!: Date;

  @Prop({ required: true, trim: true })
  city!: string;

  @Prop({ required: true, min: 1 })
  guestCount!: number;

  /** Integer paisa. Optional - not every customer wants to show their hand. */
  @Prop()
  budget?: number;

  @Prop({ trim: true, maxlength: 1000 })
  notes?: string;

  @Prop({ type: [EnquiryVendorSchema], required: true })
  vendors!: EnquiryVendor[];

  /** After this, unanswered legs expire and stop counting against the SLA. */
  @Prop({ required: true })
  expiresAt!: Date;
}

export const EnquirySchema = SchemaFactory.createForClass(Enquiry);

EnquirySchema.index({ customerId: 1, createdAt: -1 });
// The vendor inbox query: their leg, newest first, filtered by status.
EnquirySchema.index({ 'vendors.vendorId': 1, 'vendors.status': 1, createdAt: -1 });
EnquirySchema.index({ expiresAt: 1 });
