import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { VendorCategory } from '@eventhub/contracts';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ _id: false })
export class Scores {
  @Prop({ required: true, min: 1, max: 5 }) quality!: number;
  @Prop({ required: true, min: 1, max: 5 }) professionalism!: number;
  @Prop({ required: true, min: 1, max: 5 }) value!: number;
  @Prop({ required: true, min: 1, max: 5 }) flexibility!: number;
}
const ScoresSchema = SchemaFactory.createForClass(Scores);

@Schema({ _id: false })
export class VendorReply {
  @Prop({ required: true, trim: true }) body!: string;
  @Prop({ required: true }) repliedAt!: Date;
}
const VendorReplySchema = SchemaFactory.createForClass(VendorReply);

/**
 * One review, tied to one booking.
 *
 * The booking is the whole point. Anyone can write a review on a platform that
 * only asks for an account, and every such platform spends its life fighting
 * fakes; here a review exists only where money already changed hands, which the
 * unique index on bookingId enforces rather than trusting the service layer to
 * remember.
 *
 * The snapshot fields - category, eventDate, amountPaid - are copied rather
 * than joined. A review is a statement about a job as it was on the day: if the
 * vendor later changes category or the booking is amended, the review must keep
 * describing what was actually reviewed.
 */
@Schema({ timestamps: true, collection: 'vendor_reviews' })
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  authorName!: string;

  /** The mean of the four scores, stored so sorting does not recompute it. */
  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ type: ScoresSchema, required: true })
  scores!: Scores;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  body!: string;

  @Prop({ type: String, enum: Object.values(VendorCategory), required: true })
  category!: VendorCategory;

  @Prop({ required: true })
  eventDate!: Date;

  /** Paisa actually paid. Published only as a band, never as the figure. */
  @Prop()
  amountPaid?: number;

  @Prop({ type: VendorReplySchema })
  vendorReply?: VendorReply;

  createdAt!: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

/**
 * One booking, one review. Enforced here rather than in the service, because a
 * second window or a double-tapped submit would slip past a read-then-write
 * check and there would be no way to tell afterwards which one was real.
 */
ReviewSchema.index({ bookingId: 1 }, { unique: true });

/** The vendor's review list, newest first - the only way it is ever read. */
ReviewSchema.index({ vendorId: 1, createdAt: -1 });
