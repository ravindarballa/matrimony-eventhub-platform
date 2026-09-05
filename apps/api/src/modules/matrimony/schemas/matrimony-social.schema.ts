import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { InterestStatus } from '@eventhub/contracts';

/**
 * The three collections that sit between profiles: who asked whom, who saved
 * whom, and who wants never to see whom again. Grouped in one file because they
 * are small, share a shape, and are always changed together.
 */

// --------------------------------------------------------------------- interests

export type InterestDocument = HydratedDocument<Interest>;

@Schema({ timestamps: true, collection: 'interests' })
export class Interest {
  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  fromProfileId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  toProfileId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(InterestStatus),
    default: InterestStatus.SENT,
  })
  status!: InterestStatus;

  @Prop({ trim: true, maxlength: 500 })
  message?: string;

  @Prop()
  respondedAt?: Date;
}

export const InterestSchema = SchemaFactory.createForClass(Interest);

// The pair is unique, which makes a duplicate interest impossible rather than
// merely discouraged - no amount of double-tapping can create a second one.
InterestSchema.index({ fromProfileId: 1, toProfileId: 1 }, { unique: true });
// The received inbox: newest first, filtered by status.
InterestSchema.index({ toProfileId: 1, status: 1, createdAt: -1 });
InterestSchema.index({ fromProfileId: 1, createdAt: -1 });

// -------------------------------------------------------------------- shortlists

export type ShortlistDocument = HydratedDocument<Shortlist>;

@Schema({ timestamps: true, collection: 'shortlists' })
export class Shortlist {
  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  profileId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  targetProfileId!: Types.ObjectId;

  /** Private to the owner. Never projected into anyone else's response. */
  @Prop({ trim: true, maxlength: 500 })
  note?: string;
}

export const ShortlistSchema = SchemaFactory.createForClass(Shortlist);

ShortlistSchema.index({ profileId: 1, targetProfileId: 1 }, { unique: true });

// ------------------------------------------------------------------------ blocks

export type BlockDocument = HydratedDocument<Block>;

/**
 * A block. Checked in both directions on every profile read and every search,
 * because "I never want to see them again" has to mean they cannot see me
 * either - otherwise blocking merely tells the other party they were blocked.
 */
@Schema({ timestamps: true, collection: 'blocks' })
export class Block {
  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  blockerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  blockedId!: Types.ObjectId;

  @Prop({ trim: true, maxlength: 500 })
  reason?: string;
}

export const BlockSchema = SchemaFactory.createForClass(Block);

BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// The reverse lookup: who has blocked me.
BlockSchema.index({ blockedId: 1 });

// ------------------------------------------------------------- partner preferences

export type PartnerPreferenceDocument = HydratedDocument<PartnerPreference>;

/**
 * Kept out of the profile document deliberately: preferences are rewritten far
 * more often than the profile itself, and rewriting a large embedded document
 * on every tweak is waste that shows up as write amplification.
 */
@Schema({ timestamps: true, collection: 'partner_preferences' })
export class PartnerPreference {
  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  profileId!: Types.ObjectId;

  @Prop({ required: true, min: 18, max: 100 }) ageMin!: number;
  @Prop({ required: true, min: 18, max: 100 }) ageMax!: number;

  @Prop({ min: 120, max: 250 }) heightMinCm?: number;
  @Prop({ min: 120, max: 250 }) heightMaxCm?: number;

  @Prop({ type: [String], default: [] }) communities!: string[];
  @Prop({ type: [String], default: [] }) cities!: string[];
  @Prop({ type: [String], default: [] }) education!: string[];

  @Prop({ type: String }) diet?: string;

  @Prop({ type: [String], default: [] }) maritalStatuses!: string[];

  /** A hard filter, never a preference: families cannot consider their gotra. */
  @Prop({ type: [String], default: [] }) excludeGotras!: string[];
}

export const PartnerPreferenceSchema =
  SchemaFactory.createForClass(PartnerPreference);

PartnerPreferenceSchema.index({ profileId: 1 }, { unique: true });
