import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { PhotoPrivacy, ProfileStatus } from '@eventhub/contracts';

export type MatrimonyProfileDocument = HydratedDocument<MatrimonyProfile>;

@Schema({ _id: false })
export class Education {
  @Prop({ trim: true }) highestQualification?: string;
  @Prop({ trim: true }) fieldOfStudy?: string;
  @Prop({ trim: true }) institution?: string;
}

@Schema({ _id: false })
export class Career {
  @Prop({ trim: true }) occupation?: string;
  @Prop({ trim: true }) employer?: string;
  /** Integer paisa per year. Never shown as an exact figure to anyone else. */
  @Prop() annualIncome?: number;
}

@Schema({ _id: false })
export class Family {
  @Prop({ trim: true }) fatherOccupation?: string;
  @Prop({ trim: true }) motherOccupation?: string;
  @Prop() siblings?: number;
  @Prop({ type: String, enum: ['JOINT', 'NUCLEAR'] }) familyType?: string;
  @Prop({ trim: true }) nativePlace?: string;
}

/**
 * Birth details.
 *
 * `birthTime` and `birthPlace` are personal enough that they never leave the
 * server: the DTO another member sees carries the derived nakshatra and rashi
 * only, which is all the guna calculation needs.
 */
@Schema({ _id: false })
export class Horoscope {
  @Prop({ trim: true }) birthTime?: string;
  @Prop({ trim: true }) birthPlace?: string;
  @Prop({ min: 1, max: 27 }) nakshatra?: number;
  @Prop({ min: 1, max: 12 }) rashi?: number;
  @Prop({ min: 1, max: 12 }) marsHouse?: number;
  @Prop() manglik?: boolean;
}

@Schema({ _id: false })
export class Photo {
  @Prop({ required: true }) id!: string;
  @Prop({ required: true }) url!: string;
  @Prop({ default: false }) isPrimary!: boolean;
  /** Nothing is visible to another member until a moderator approves it. */
  @Prop({
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  })
  moderation!: 'PENDING' | 'APPROVED' | 'REJECTED';
  @Prop({ trim: true }) rejectionReason?: string;
}

@Schema({ _id: false })
export class Privacy {
  @Prop({
    type: String,
    enum: Object.values(PhotoPrivacy),
    default: PhotoPrivacy.MEMBERS_ONLY,
  })
  photos!: PhotoPrivacy;

  @Prop({
    type: String,
    enum: ['ON_MUTUAL_INTEREST', 'MEMBERS_ONLY'],
    default: 'ON_MUTUAL_INTEREST',
  })
  showContact!: 'ON_MUTUAL_INTEREST' | 'MEMBERS_ONLY';
}

const EducationSchema = SchemaFactory.createForClass(Education);
const CareerSchema = SchemaFactory.createForClass(Career);
const FamilySchema = SchemaFactory.createForClass(Family);
const HoroscopeSchema = SchemaFactory.createForClass(Horoscope);
const PhotoSchema = SchemaFactory.createForClass(Photo);
const PrivacySchema = SchemaFactory.createForClass(Privacy);

/**
 * A matrimony profile.
 *
 * Education, career, family and horoscope are embedded because they are always
 * read with the profile and never queried on their own. Partner preferences are
 * NOT embedded - they are rewritten far more often than the profile itself, and
 * a rewrite of the whole document on every preference tweak would be wasteful.
 */
@Schema({ timestamps: true, collection: 'matrimony_profiles' })
export class MatrimonyProfile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  displayName!: string;

  @Prop({
    type: String,
    enum: ['SELF', 'PARENT', 'SIBLING', 'RELATIVE'],
    default: 'SELF',
  })
  managedBy!: string;

  @Prop({ type: String, enum: ['MALE', 'FEMALE'], required: true })
  gender!: string;

  @Prop({ required: true })
  dateOfBirth!: Date;

  @Prop({ required: true, min: 120, max: 250 })
  heightCm!: number;

  @Prop({
    type: String,
    enum: ['NEVER_MARRIED', 'DIVORCED', 'WIDOWED', 'AWAITING_DIVORCE'],
    default: 'NEVER_MARRIED',
  })
  maritalStatus!: string;

  @Prop({ required: true, trim: true }) religion!: string;
  @Prop({ required: true, trim: true }) community!: string;
  @Prop({ trim: true }) gotra?: string;
  @Prop({ required: true, trim: true }) motherTongue!: string;
  @Prop({ required: true, trim: true }) city!: string;
  @Prop({ trim: true }) state?: string;

  @Prop({
    type: String,
    enum: ['VEGETARIAN', 'NON_VEGETARIAN', 'EGGETARIAN', 'VEGAN', 'JAIN'],
    default: 'VEGETARIAN',
  })
  diet!: string;

  @Prop({ trim: true, maxlength: 2000 })
  about?: string;

  @Prop({ type: EducationSchema, default: {} }) education!: Education;
  @Prop({ type: CareerSchema, default: {} }) career!: Career;
  @Prop({ type: FamilySchema, default: {} }) family!: Family;
  @Prop({ type: HoroscopeSchema, default: {} }) horoscope!: Horoscope;
  @Prop({ type: [PhotoSchema], default: [] }) photos!: Photo[];
  @Prop({ type: PrivacySchema, default: {} }) privacy!: Privacy;

  @Prop({
    type: String,
    enum: Object.values(ProfileStatus),
    default: ProfileStatus.DRAFT,
  })
  status!: ProfileStatus;

  /** 0-100. Drives completion nudges and ranks better-filled profiles higher. */
  @Prop({ default: 0 })
  completeness!: number;

  @Prop({ default: false })
  verified!: boolean;

  /** Set when the profile goes ENGAGED - the handoff into the events module. */
  @Prop()
  engagedAt?: Date;
}

export const MatrimonyProfileSchema =
  SchemaFactory.createForClass(MatrimonyProfile);

// One profile per user.
MatrimonyProfileSchema.index({ userId: 1 }, { unique: true });

/**
 * The index that carries search. Field order follows the ESR rule - equality
 * first, then the sort field, then ranges - because Mongo can only use an index
 * prefix that way round. Reorder these and the sort becomes an in-memory sort.
 */
MatrimonyProfileSchema.index(
  {
    status: 1,
    gender: 1,
    religion: 1,
    community: 1,
    city: 1,
    updatedAt: -1,
    dateOfBirth: 1,
    heightCm: 1,
  },
  { name: 'profile_search_esr' },
);

/**
 * A partial index over the only profiles that are ever searched, so it holds a
 * fraction of the collection and stays resident in memory.
 */
MatrimonyProfileSchema.index(
  { city: 1, community: 1, dateOfBirth: 1 },
  {
    name: 'profile_active_only',
    partialFilterExpression: { status: ProfileStatus.ACTIVE, verified: true },
  },
);
