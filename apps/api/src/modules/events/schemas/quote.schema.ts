import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { VendorCategory, type QuoteLineItem } from '@eventhub/contracts';

export type QuoteDocument = HydratedDocument<Quote>;

@Schema({ timestamps: true, collection: 'quotes' })
export class Quote {
  @Prop({ type: Types.ObjectId, ref: 'Enquiry', required: true, index: true })
  enquiryId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Wedding', required: true })
  weddingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(VendorCategory), required: true })
  category!: VendorCategory;

  @Prop({ required: true })
  functionDate!: Date;

  /** Embedded: line items are always read with their quote, never alone. */
  @Prop({ type: Array, required: true })
  lineItems!: QuoteLineItem[];

  @Prop({ required: true }) subtotal!: number;
  @Prop({ required: true }) gstAmount!: number;
  @Prop({ required: true }) total!: number;

  /** Platform bounds are 10-50%; enforced in the DTO and the service. */
  @Prop({ required: true, min: 10, max: 50 })
  advancePercent!: number;

  @Prop({ required: true })
  validUntil!: Date;

  @Prop({
    type: String,
    enum: ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'],
    default: 'SENT',
  })
  status!: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
}

export const QuoteSchema = SchemaFactory.createForClass(Quote);

// One quote per vendor per enquiry.
QuoteSchema.index({ enquiryId: 1, vendorId: 1 }, { unique: true });
QuoteSchema.index({ validUntil: 1, status: 1 });
