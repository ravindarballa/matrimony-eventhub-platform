import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Role, UserStatus } from '@eventhub/contracts';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class Consent {
  @Prop({ required: true }) accepted!: boolean;
  @Prop({ required: true }) version!: string;
  @Prop({ required: true }) acceptedAt!: Date;
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, unique: true, index: true })
  mobile!: string;

  @Prop({ lowercase: true, trim: true, sparse: true, unique: true })
  email?: string;

  /**
   * `select: false` keeps the hash out of every query result unless a caller
   * explicitly asks for it, so it cannot leak through a forgotten projection.
   */
  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ type: [String], enum: Object.values(Role), default: [], index: true })
  roles!: Role[];

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.PENDING_VERIFICATION,
  })
  status!: UserStatus;

  @Prop({ default: false })
  mobileVerified!: boolean;

  @Prop({ default: false })
  emailVerified!: boolean;

  @Prop({ type: Consent })
  consent?: Consent;

  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  @Prop()
  lockedUntil?: Date;

  @Prop()
  lastLoginAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Never serialise the hash, even if a caller explicitly selected it.
UserSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    const out = ret as unknown as Record<string, unknown>;
    delete out['passwordHash'];
    delete out['__v'];
    return out;
  },
});
