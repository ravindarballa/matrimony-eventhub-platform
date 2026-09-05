import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { KycStatus, VendorCategory } from '@eventhub/contracts';

export type VendorDocument = HydratedDocument<Vendor>;

/**
 * Bank and tax identifiers.
 *
 * `select: false` keeps the whole block out of every query result unless a
 * caller explicitly asks for it - the same treatment the password hash gets.
 * A vendor's bank account must never travel in a search response by accident,
 * and staff accounts are never permitted to see it at all.
 */
@Schema({ _id: false })
export class KycDetails {
  @Prop({ required: true, uppercase: true, trim: true }) pan!: string;
  @Prop({ uppercase: true, trim: true }) gstin?: string;
  @Prop({ required: true, trim: true }) bankAccountName!: string;
  @Prop({ required: true, trim: true }) bankAccountNumber!: string;
  @Prop({ required: true, uppercase: true, trim: true }) ifsc!: string;
  @Prop({ required: true }) submittedAt!: Date;
}

export const KycDetailsSchema = SchemaFactory.createForClass(KycDetails);

@Schema({ timestamps: true, collection: 'vendors' })
export class Vendor {
  /**
   * One vendor organisation per owner. The unique index is declared once at the
   * bottom of this file - adding index: true here as well would generate a
   * second, non-unique ownerId_1 and the two definitions collide on sync.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  businessName!: string;

  @Prop({ type: String, enum: Object.values(VendorCategory), required: true })
  category!: VendorCategory;

  @Prop({ required: true, trim: true })
  city!: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  description!: string;

  @Prop({
    type: String,
    enum: Object.values(KycStatus),
    default: KycStatus.NOT_STARTED,
    index: true,
  })
  kycStatus!: KycStatus;

  @Prop({ type: KycDetailsSchema, select: false })
  kyc?: KycDetails;

  @Prop({ trim: true })
  kycRejectionReason?: string;

  @Prop()
  kycVerifiedAt?: Date;

  /** A vendor may take itself out of search without being deleted. */
  @Prop({ default: true })
  isActive!: boolean;

  /**
   * Denormalised from the catalogue so search can sort and filter on price
   * without joining every service. Recomputed whenever a service changes.
   */
  @Prop()
  priceFrom?: number;

  @Prop({ default: 0 }) rating!: number;
  @Prop({ default: 0 }) reviewCount!: number;
  @Prop({ default: 0 }) completedBookings!: number;

  /**
   * Median minutes from enquiry to first quote. The architecture makes this a
   * ranking input, so it is stored rather than computed per search.
   */
  @Prop()
  medianResponseMins?: number;

  /** Rolling inputs behind the median, kept small deliberately. */
  @Prop({ type: [Number], default: [] })
  recentResponseMins!: number[];
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);

// One organisation per owner: a second onboarding attempt must fail loudly
// rather than quietly creating a duplicate listing.
VendorSchema.index({ ownerId: 1 }, { unique: true });
// The search index: category and city narrow first, then rank.
VendorSchema.index({ category: 1, city: 1, isActive: 1, rating: -1 });
VendorSchema.index({ kycStatus: 1, createdAt: 1 });
