import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type ChatThreadDocument = HydratedDocument<ChatThread>;
export type ChatMessageDocument = HydratedDocument<ChatMessage>;

/**
 * A conversation between exactly two profiles.
 *
 * Created by the platform when an interest is accepted, never by a member
 * reaching out cold. That is what stops chat becoming an unsolicited inbox,
 * and it is the reason families are willing to have one at all.
 */
@Schema({ timestamps: true, collection: 'chat_threads' })
export class ChatThread {
  /** Exactly two, sorted, so a pair maps to one thread however it is created. */
  @Prop({ type: [Types.ObjectId], ref: 'MatrimonyProfile', required: true })
  participantIds!: Types.ObjectId[];

  /** The interest that opened it. Unique, so acceptance cannot open two. */
  @Prop({ type: Types.ObjectId, ref: 'Interest', required: true })
  interestId!: Types.ObjectId;

  @Prop() lastMessageAt?: Date;

  /** Denormalised for the thread list, which would otherwise need a join. */
  @Prop({ trim: true }) lastMessagePreview?: string;

  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile' })
  lastMessageBy?: Types.ObjectId;
}

export const ChatThreadSchema = SchemaFactory.createForClass(ChatThread);

// One thread per accepted interest, enforced rather than assumed: the listener
// that creates them can be replayed, and a duplicate delivery must be harmless.
ChatThreadSchema.index({ interestId: 1 }, { unique: true });
// The inbox query: my threads, most recently active first.
ChatThreadSchema.index({ participantIds: 1, lastMessageAt: -1 });

/**
 * One message.
 *
 * Referenced rather than embedded in the thread: an unbounded array would
 * eventually hit the 16 MB document limit, and long before that every read of
 * the thread list would drag the entire history with it.
 */
@Schema({ timestamps: true, collection: 'chat_messages' })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, ref: 'ChatThread', required: true, index: true })
  threadId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MatrimonyProfile', required: true })
  senderProfileId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  body!: string;

  /** Set when the other participant has seen it. */
  @Prop() readAt?: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

// Paging a conversation backwards from the newest message.
ChatMessageSchema.index({ threadId: 1, createdAt: -1 });
// Counting what one participant has not yet read.
ChatMessageSchema.index({ threadId: 1, senderProfileId: 1, readAt: 1 });
