import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { LedgerAccount } from '@eventhub/contracts';

export type LedgerEntryDocument = HydratedDocument<LedgerEntry>;

/**
 * One line of the double-entry ledger. Append-only: a correction is another
 * entry, never an edit, so the history of what the platform believed at each
 * point remains readable.
 *
 * Every entry carries the group it was written with (`refType`/`refId`), and
 * within a group the debits equal the credits. That is what lets the ledger be
 * summed and reconciled against gateway settlement reports.
 */
@Schema({ timestamps: true, collection: 'ledger_entries' })
export class LedgerEntry {
  @Prop({ type: String, enum: Object.values(LedgerAccount), required: true })
  account!: LedgerAccount;

  /** Integer paisa. Exactly one of debit/credit is non-zero. */
  @Prop({ required: true, default: 0 }) debit!: number;
  @Prop({ required: true, default: 0 }) credit!: number;

  /** What caused this entry - 'payment' or 'refund'. */
  @Prop({ required: true }) refType!: string;
  @Prop({ type: Types.ObjectId, required: true }) refId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Booking', index: true })
  bookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', index: true })
  vendorId?: Types.ObjectId;

  @Prop({ required: true }) description!: string;

  /**
   * Groups the lines written together. Unique per (group, account) so replaying
   * a capture cannot double-post, even if the guard above it is bypassed.
   */
  @Prop({ required: true }) groupId!: string;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

LedgerEntrySchema.index({ groupId: 1, account: 1 }, { unique: true });
LedgerEntrySchema.index({ refType: 1, refId: 1 });
LedgerEntrySchema.index({ account: 1, createdAt: 1 });
