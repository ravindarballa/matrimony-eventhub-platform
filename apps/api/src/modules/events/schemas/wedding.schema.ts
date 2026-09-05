import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type WeddingDocument = HydratedDocument<Wedding>;

@Schema({ _id: false })
export class CoupleNames {
  @Prop({ required: true, trim: true }) bride!: string;
  @Prop({ required: true, trim: true }) groom!: string;
}

export const CoupleNamesSchema = SchemaFactory.createForClass(CoupleNames);

/**
 * The wedding every booking hangs off.
 *
 * It exists so a customer's vendors are one event rather than a pile of
 * unrelated bookings: the budget is tracked against it, and the functions
 * (mehendi, sangeet, wedding) share its date and city by default.
 */
@Schema({ timestamps: true, collection: 'weddings' })
export class Wedding {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({ type: CoupleNamesSchema, required: true })
  coupleNames!: CoupleNames;

  @Prop({ required: true })
  primaryDate!: Date;

  @Prop({ required: true, trim: true })
  city!: string;

  @Prop({ required: true, min: 1 })
  guestEstimate!: number;

  /** Integer paisa. What the family intends to spend in total. */
  @Prop({ required: true, min: 0 })
  budgetTotal!: number;

  /** Set when the wedding was seeded from a matrimony profile going engaged. */
  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile' })
  sourceProfileId?: Types.ObjectId;
}

export const WeddingSchema = SchemaFactory.createForClass(Wedding);

WeddingSchema.index({ customerId: 1, primaryDate: 1 });
