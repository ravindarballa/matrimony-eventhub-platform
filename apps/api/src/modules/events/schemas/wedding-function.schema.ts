import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { FunctionType } from '@eventhub/contracts';

export type WeddingFunctionDocument = HydratedDocument<WeddingFunction>;

/**
 * One ceremony within a wedding - mehendi, haldi, sangeet, the wedding itself,
 * the reception.
 *
 * Its own collection rather than an array on the wedding, because each function
 * has its own date, its own guest count and its own vendors: a caterer booked
 * for the sangeet is not booked for the reception, and flattening them into one
 * event is how a family ends up with dinner on the wrong night.
 */
@Schema({ timestamps: true, collection: 'wedding_functions' })
export class WeddingFunction {
  @Prop({ type: Types.ObjectId, ref: 'Wedding', required: true, index: true })
  weddingId!: Types.ObjectId;

  /** Denormalised so ownership can be checked without loading the wedding. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(FunctionType), required: true })
  type!: FunctionType;

  /** UTC midnight, like every other date the availability calendar compares. */
  @Prop({ required: true })
  date!: Date;

  @Prop({ required: true, min: 1 })
  guestCount!: number;
}

export const WeddingFunctionSchema =
  SchemaFactory.createForClass(WeddingFunction);

// One function of each type per wedding: a family has one mehendi, not three.
WeddingFunctionSchema.index({ weddingId: 1, type: 1 }, { unique: true });
WeddingFunctionSchema.index({ weddingId: 1, date: 1 });
