import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({ timestamps: true, collection: 'sessions' })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** SHA-256 of the opaque refresh token. The token itself is never stored. */
  @Prop({ required: true, unique: true })
  refreshTokenHash!: string;

  /**
   * All tokens descended from one login share a familyId. Presenting an already
   * rotated token means the token was stolen, so the whole family is revoked.
   */
  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ default: 'Unknown device' })
  device!: string;

  @Prop()
  ip?: string;

  @Prop()
  city?: string;

  @Prop({ default: Date.now })
  lastSeenAt!: Date;

  @Prop({ default: false })
  revoked!: boolean;

  /** TTL index below expires the document automatically at this instant. */
  @Prop({ required: true })
  expiresAt!: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ userId: 1, revoked: 1 });
