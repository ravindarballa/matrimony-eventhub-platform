import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { PricingModel } from '@eventhub/contracts';

export type VendorServiceDocument = HydratedDocument<VendorService>;

/**
 * One sellable package.
 *
 * Its own collection rather than an array on the vendor: a caterer may carry
 * dozens of menu tiers, they are edited individually, and search filters on
 * their prices. Embedding would mean rewriting the whole vendor document to
 * change one price.
 */
@Schema({ timestamps: true, collection: 'vendor_services' })
export class VendorService {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  description!: string;

  @Prop({ type: String, enum: Object.values(PricingModel), required: true })
  pricingModel!: PricingModel;

  /** Integer paisa, per unit of the pricing model. */
  @Prop({ required: true, min: 0 })
  basePrice!: number;

  /** PER_PLATE only: the minimum billable head count. */
  @Prop({ min: 0 })
  minimumUnits?: number;

  /** Venues only. */
  @Prop({ min: 0 })
  capacity?: number;

  @Prop({ type: [String], default: [] })
  inclusions!: string[];

  @Prop({ default: true })
  isActive!: boolean;
}

export const VendorServiceSchema = SchemaFactory.createForClass(VendorService);

VendorServiceSchema.index({ vendorId: 1, isActive: 1 });
VendorServiceSchema.index({ basePrice: 1 });
