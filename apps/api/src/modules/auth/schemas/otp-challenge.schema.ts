import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { OtpPurpose } from '@eventhub/contracts';

export type OtpChallengeDocument = HydratedDocument<OtpChallenge>;

@Schema({ timestamps: true, collection: 'otp_challenges' })
export class OtpChallenge {
  @Prop({ required: true, index: true })
  mobile!: string;

  /** SHA-256 of the code. The plaintext OTP is never persisted or logged. */
  @Prop({ required: true })
  codeHash!: string;

  @Prop({ type: String, enum: Object.values(OtpPurpose), required: true })
  purpose!: OtpPurpose;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ default: false })
  consumed!: boolean;

  @Prop({ required: true })
  expiresAt!: Date;
}

export const OtpChallengeSchema = SchemaFactory.createForClass(OtpChallenge);

OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpChallengeSchema.index({ mobile: 1, purpose: 1, consumed: 1 });
