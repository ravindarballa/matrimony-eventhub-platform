import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  Capability,
  ErrorCode,
  MAX_MESSAGE_LENGTH,
  type ChatMessageDto,
  type ChatThreadDto,
} from '@eventhub/contracts';

import { EntitlementsService } from '../../subscriptions/services/entitlements.service.js';
import {
  ChatMessage,
  ChatThread,
  type ChatMessageDocument,
  type ChatThreadDocument,
} from '../schemas/chat.schema.js';
import { ProfilesService } from './profiles.service.js';
import { RelationsService } from './relations.service.js';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

const PAGE_SIZE = 50;

/**
 * Conversations, unlocked by mutual interest and paid for by a plan.
 *
 * The two gates are the same pair the contact details sit behind, and in the
 * same order. Consent first: a thread only exists because both families
 * accepted, so nobody can be messaged by a stranger no matter what they have
 * paid. Then the plan, which is what the subscription actually sells.
 *
 * Reading is free for both sides. Charging someone to read a reply they did
 * not ask for would be a trap rather than a product.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(ChatThread.name)
    private readonly threads: Model<ChatThreadDocument>,
    @InjectModel(ChatMessage.name)
    private readonly messages: Model<ChatMessageDocument>,
    private readonly profiles: ProfilesService,
    private readonly relations: RelationsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Opens the thread when an interest is accepted.
   *
   * Driven by the domain event rather than called from the interests service,
   * so accepting an interest stays unaware that chat exists. The unique index
   * on interestId makes a redelivered event harmless.
   */
  @OnEvent('matrimony.interest.accepted')
  async onInterestAccepted(payload: {
    interestId: string;
    profileIds: string[];
  }): Promise<void> {
    try {
      const ids = payload.profileIds.map((id) => new Types.ObjectId(id));
      await this.threads.create({
        // Sorted, so the same pair always produces the same array however the
        // event happened to order them.
        participantIds: ids.sort((a, b) => (a.toString() < b.toString() ? -1 : 1)),
        interestId: new Types.ObjectId(payload.interestId),
      });
    } catch (e) {
      if (isDuplicateKey(e)) return;
      // A conversation that failed to open must not fail the acceptance that
      // caused it - that has already committed.
      this.logger.error('Could not open a chat thread', e as Error);
    }
  }

  /** The reader's conversations, most recently active first. */
  async listThreads(userId: string): Promise<ChatThreadDto[]> {
    const mine = await this.profiles.requireOwn(userId);
    const blocked = new Set(
      (await this.relations.blockedIds(mine._id)).map((id) => id.toString()),
    );

    const rows = await this.threads
      .find({ participantIds: mine._id })
      .sort({ lastMessageAt: -1, createdAt: -1 });

    const threads = await Promise.all(
      rows.map(async (thread): Promise<ChatThreadDto | null> => {
        const otherId = thread.participantIds.find(
          (id) => !id.equals(mine._id),
        );
        // A block hides the conversation from both sides, like everything else.
        if (!otherId || blocked.has(otherId.toString())) return null;

        const other = await this.profiles
          .findById(otherId.toString())
          .catch(() => null);
        if (!other) return null;

        const compatibility = this.profiles.compatibility(mine, other);

        return {
          id: thread.id as string,
          counterpart: this.profiles.toCard(other, {
            mutual: true,
            gunaScore: compatibility?.total ?? null,
          }),
          lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
          lastMessagePreview: thread.lastMessagePreview ?? null,
          unreadCount: await this.messages.countDocuments({
            threadId: thread._id,
            senderProfileId: otherId,
            readAt: { $exists: false },
          }),
          createdAt: (thread as unknown as { createdAt: Date }).createdAt.toISOString(),
        };
      }),
    );

    return threads.filter((t): t is ChatThreadDto => t !== null);
  }

  /**
   * One conversation, newest last so it reads top to bottom.
   *
   * Opening it marks the other side's messages read, which is the only thing
   * that makes an unread count mean anything.
   */
  async messagesIn(userId: string, threadId: string): Promise<ChatMessageDto[]> {
    const { mine, thread, otherId } = await this.requireParticipant(userId, threadId);

    await this.messages.updateMany(
      { threadId: thread._id, senderProfileId: otherId, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );

    const rows = await this.messages
      .find({ threadId: thread._id })
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE);

    return rows.reverse().map((m) => ({
      id: m.id as string,
      threadId: thread.id as string,
      mine: m.senderProfileId.equals(mine._id),
      body: m.body,
      sentAt: (m as unknown as { createdAt: Date }).createdAt.toISOString(),
      readAt: m.readAt?.toISOString() ?? null,
    }));
  }

  /** Sends a message. This is the part a plan pays for. */
  async send(
    userId: string,
    threadId: string,
    body: string,
  ): Promise<ChatMessageDto> {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { body: 'Write something first.' },
      });
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { body: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` },
      });
    }

    const { mine, thread, otherId } = await this.requireParticipant(userId, threadId);

    if (await this.relations.isBlocked(mine._id, otherId)) {
      throw new NotFoundException();
    }

    const verdict = await this.entitlements.can(
      userId,
      Capability.MATRIMONY_START_CHAT,
    );
    if (!verdict.allowed) {
      throw new ConflictException({
        code: ErrorCode.MAT_QUOTA_EXCEEDED,
        message: 'Sending messages is part of a paid plan. Reading is always free.',
      });
    }

    const created = await this.messages.create({
      threadId: thread._id,
      senderProfileId: mine._id,
      body: trimmed,
    });

    thread.lastMessageAt = new Date();
    thread.lastMessagePreview = trimmed.slice(0, 120);
    thread.lastMessageBy = mine._id;
    await thread.save();

    return {
      id: created.id as string,
      threadId: thread.id as string,
      mine: true,
      body: created.body,
      sentAt: (created as unknown as { createdAt: Date }).createdAt.toISOString(),
      readAt: null,
    };
  }

  /** Total unread across every conversation. Drives the badge. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const mine = await this.profiles.requireOwn(userId).catch(() => null);
    if (!mine) return { count: 0 };

    const threadIds = (
      await this.threads.find({ participantIds: mine._id }).select('_id')
    ).map((t) => t._id);
    if (!threadIds.length) return { count: 0 };

    return {
      count: await this.messages.countDocuments({
        threadId: { $in: threadIds },
        senderProfileId: { $ne: mine._id },
        readAt: { $exists: false },
      }),
    };
  }

  private async requireParticipant(
    userId: string,
    threadId: string,
  ): Promise<{
    mine: Awaited<ReturnType<ProfilesService['requireOwn']>>;
    thread: ChatThreadDocument;
    otherId: Types.ObjectId;
  }> {
    const mine = await this.profiles.requireOwn(userId);
    if (!Types.ObjectId.isValid(threadId)) throw new NotFoundException();

    const thread = await this.threads.findById(threadId);
    if (!thread) throw new NotFoundException();

    if (!thread.participantIds.some((id) => id.equals(mine._id))) {
      throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);
    }

    const otherId = thread.participantIds.find((id) => !id.equals(mine._id));
    if (!otherId) throw new NotFoundException();

    return { mine, thread, otherId };
  }
}
