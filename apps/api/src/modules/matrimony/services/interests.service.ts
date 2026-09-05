import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  ErrorCode,
  FREE_DAILY_INTEREST_QUOTA,
  InterestStatus,
  ProfileStatus,
  type InterestDto,
  type SendInterestRequest,
  type ShortlistEntryDto,
} from '@eventhub/contracts';

import {
  Interest,
  type InterestDocument,
} from '../schemas/matrimony-social.schema.js';
import type { MatrimonyProfileDocument } from '../schemas/matrimony-profile.schema.js';
import { ProfilesService } from './profiles.service.js';
import { RelationsService } from './relations.service.js';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/**
 * The two-sided state machine at the centre of the product.
 *
 * Sent goes to accepted, declined or withdrawn, and nothing else. Contact
 * details unlock on acceptance and only then - that single rule is the paywall
 * the whole matrimony business model rests on, so it is enforced here rather
 * than by any client remembering to hide a field.
 */
@Injectable()
export class InterestsService {
  constructor(
    @InjectModel(Interest.name) private readonly interests: Model<InterestDocument>,
    private readonly profiles: ProfilesService,
    private readonly relations: RelationsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Sends an interest.
   *
   * The daily quota is what a subscription lifts. It is counted server-side
   * from the sender's own history, because a client-side counter is a
   * suggestion, and this one is the revenue model.
   */
  async send(userId: string, dto: SendInterestRequest): Promise<InterestDto> {
    const from = await this.profiles.requireOwn(userId);
    const to = await this.profiles.findById(dto.toProfileId);

    if (from._id.equals(to._id)) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You cannot send an interest to yourself.',
      });
    }
    if (from.status !== ProfileStatus.ACTIVE) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Publish your own profile before sending interests.',
      });
    }
    // A block masks the profile entirely, in both directions.
    if (await this.relations.isBlocked(from._id, to._id)) {
      throw new NotFoundException();
    }
    if (to.status !== ProfileStatus.ACTIVE) {
      throw new ConflictException({
        code: ErrorCode.MAT_PROFILE_PRIVATE,
        message: 'This profile is not accepting interests.',
      });
    }

    const usedToday = await this.sentToday(from._id);
    if (usedToday >= FREE_DAILY_INTEREST_QUOTA) {
      throw new ConflictException({
        code: ErrorCode.MAT_QUOTA_EXCEEDED,
        message: `You have used all ${FREE_DAILY_INTEREST_QUOTA} interests for today. A plan lifts this limit.`,
      });
    }

    try {
      const created = await this.interests.create({
        fromProfileId: from._id,
        toProfileId: to._id,
        message: dto.message,
        status: InterestStatus.SENT,
      });

      this.events.emit('matrimony.interest.sent', {
        interestId: created.id as string,
        fromProfileId: from.id as string,
        toProfileId: to.id as string,
      });

      return this.toDto(created, from, to, false, from);
    } catch (e) {
      if (isDuplicateKey(e)) {
        // The unique index makes a second interest impossible. Say so plainly
        // rather than returning a 500 for what is a normal double-tap.
        throw new ConflictException({
          code: ErrorCode.MAT_DUPLICATE_INTEREST,
          message: 'You have already sent an interest to this profile.',
        });
      }
      throw e;
    }
  }

  /** Accepting is what unlocks contact details for both sides. */
  async accept(userId: string, interestId: string): Promise<InterestDto> {
    const { interest, mine, theirs } = await this.requireIncoming(userId, interestId);

    if (interest.status !== InterestStatus.SENT) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: `This interest was already ${interest.status.toLowerCase()}.`,
      });
    }

    interest.status = InterestStatus.ACCEPTED;
    interest.respondedAt = new Date();
    await interest.save();

    this.events.emit('matrimony.interest.accepted', {
      interestId: interest.id as string,
      profileIds: [mine.id as string, theirs.id as string],
    });

    // The reader is the recipient, so the card shows whoever sent it.
    return this.toDto(interest, theirs, mine, true, mine);
  }

  async decline(userId: string, interestId: string): Promise<InterestDto> {
    const { interest, mine, theirs } = await this.requireIncoming(userId, interestId);

    if (interest.status !== InterestStatus.SENT) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: `This interest was already ${interest.status.toLowerCase()}.`,
      });
    }

    interest.status = InterestStatus.DECLINED;
    interest.respondedAt = new Date();
    await interest.save();

    return this.toDto(interest, theirs, mine, false, mine);
  }

  /** Only the sender may withdraw, and only while it is still unanswered. */
  async withdraw(userId: string, interestId: string): Promise<void> {
    const mine = await this.profiles.requireOwn(userId);
    const interest = await this.requireInterest(interestId);

    if (!interest.fromProfileId.equals(mine._id)) {
      throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);
    }
    if (interest.status !== InterestStatus.SENT) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: 'This interest has already been answered.',
      });
    }

    interest.status = InterestStatus.WITHDRAWN;
    interest.respondedAt = new Date();
    await interest.save();
  }

  /**
   * The three tabs: what came in, what went out, and what was accepted by
   * either side. Accepted is deliberately both directions - once it is mutual,
   * who asked first stops mattering.
   */
  async list(
    userId: string,
    tab: 'received' | 'sent' | 'accepted',
  ): Promise<InterestDto[]> {
    const mine = await this.profiles.requireOwn(userId);

    const filter =
      tab === 'received'
        ? { toProfileId: mine._id, status: InterestStatus.SENT }
        : tab === 'sent'
          ? { fromProfileId: mine._id, status: { $ne: InterestStatus.WITHDRAWN } }
          : {
              status: InterestStatus.ACCEPTED,
              $or: [{ fromProfileId: mine._id }, { toProfileId: mine._id }],
            };

    const rows = await this.interests.find(filter).sort({ createdAt: -1 });

    return Promise.all(
      rows.map(async (interest) => {
        const otherId = interest.fromProfileId.equals(mine._id)
          ? interest.toProfileId
          : interest.fromProfileId;
        const other = await this.profiles.findById(otherId.toString());
        const mutual = interest.status === InterestStatus.ACCEPTED;

        return interest.fromProfileId.equals(mine._id)
          ? this.toDto(interest, mine, other, mutual, mine)
          : this.toDto(interest, other, mine, mutual, mine);
      }),
    );
  }

  /** How many interests the member has left today. Drives the upgrade prompt. */
  async remainingQuota(userId: string): Promise<{ used: number; limit: number }> {
    const mine = await this.profiles.requireOwn(userId);
    return {
      used: await this.sentToday(mine._id),
      limit: FREE_DAILY_INTEREST_QUOTA,
    };
  }

  // ---------------------------------------------------------------- shortlist

  async shortlist(
    userId: string,
    targetProfileId: string,
    note?: string,
  ): Promise<void> {
    const mine = await this.profiles.requireOwn(userId);
    const target = await this.profiles.findById(targetProfileId);

    if (await this.relations.isBlocked(mine._id, target._id)) {
      throw new NotFoundException();
    }
    await this.relations.shortlist(mine._id, target._id, note);
  }

  async removeShortlist(userId: string, targetProfileId: string): Promise<void> {
    const mine = await this.profiles.requireOwn(userId);
    if (!Types.ObjectId.isValid(targetProfileId)) throw new NotFoundException();
    await this.relations.removeShortlist(
      mine._id,
      new Types.ObjectId(targetProfileId),
    );
  }

  async listShortlist(userId: string): Promise<ShortlistEntryDto[]> {
    const mine = await this.profiles.requireOwn(userId);
    const rows = await this.relations.listShortlist(mine._id);

    const entries = await Promise.all(
      rows.map(async (row): Promise<ShortlistEntryDto | null> => {
        const target = await this.profiles
          .findById(row.targetProfileId.toString())
          .catch(() => null);
        if (!target) return null;

        const mutual = await this.relations.hasMutualAcceptance(
          mine._id,
          target._id,
        );
        const compatibility = this.profiles.compatibility(mine, target);

        return {
          targetProfileId: target.id as string,
          // The note is the owner's alone; it is only ever returned here.
          note: row.note ?? null,
          addedAt: (row as unknown as { createdAt: Date }).createdAt.toISOString(),
          profile: this.profiles.toCard(target, {
            mutual,
            gunaScore: compatibility?.total ?? null,
            shortlisted: true,
          }),
        };
      }),
    );

    return entries.filter((e): e is ShortlistEntryDto => e !== null);
  }

  // ------------------------------------------------------------------- blocks

  async block(userId: string, targetProfileId: string, reason?: string): Promise<void> {
    const mine = await this.profiles.requireOwn(userId);
    const target = await this.profiles.findById(targetProfileId);
    await this.relations.block(mine._id, target._id, reason);
  }

  async unblock(userId: string, targetProfileId: string): Promise<void> {
    const mine = await this.profiles.requireOwn(userId);
    if (!Types.ObjectId.isValid(targetProfileId)) throw new NotFoundException();
    await this.relations.unblock(mine._id, new Types.ObjectId(targetProfileId));
  }

  // ---------------------------------------------------------------- internals

  private async sentToday(profileId: Types.ObjectId): Promise<number> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    return this.interests.countDocuments({
      fromProfileId: profileId,
      createdAt: { $gte: since },
      // A withdrawn interest still counts: otherwise the quota is trivially
      // defeated by sending, withdrawing, and sending again.
    });
  }

  private async requireInterest(interestId: string): Promise<InterestDocument> {
    if (!Types.ObjectId.isValid(interestId)) throw new NotFoundException();
    const interest = await this.interests.findById(interestId);
    if (!interest) throw new NotFoundException();
    return interest;
  }

  /** An interest addressed to the caller, with both profiles loaded. */
  private async requireIncoming(
    userId: string,
    interestId: string,
  ): Promise<{
    interest: InterestDocument;
    mine: MatrimonyProfileDocument;
    theirs: MatrimonyProfileDocument;
  }> {
    const mine = await this.profiles.requireOwn(userId);
    const interest = await this.requireInterest(interestId);

    if (!interest.toProfileId.equals(mine._id)) {
      throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);
    }

    const theirs = await this.profiles.findById(interest.fromProfileId.toString());
    return { interest, mine, theirs };
  }

  /**
   * `sender` and `recipient` are the two sides of the interest; `reader` is
   * whoever is looking at it, and `counterpart` is the other one.
   *
   * The reader is passed in rather than inferred: deriving it from the sender
   * argument is what previously showed a recipient their own card in their
   * received inbox, which reads as a broken product rather than a subtle bug.
   */
  private toDto(
    interest: InterestDocument,
    sender: MatrimonyProfileDocument,
    recipient: MatrimonyProfileDocument,
    mutual: boolean,
    reader: MatrimonyProfileDocument,
  ): InterestDto {
    const counterpartProfile = reader._id.equals(sender._id) ? recipient : sender;
    const compatibility = this.profiles.compatibility(sender, recipient);

    return {
      id: interest.id as string,
      fromProfileId: interest.fromProfileId.toString(),
      toProfileId: interest.toProfileId.toString(),
      status: interest.status,
      message: interest.message ?? null,
      createdAt: (interest as unknown as { createdAt: Date }).createdAt.toISOString(),
      respondedAt: interest.respondedAt?.toISOString() ?? null,
      counterpart: this.profiles.toCard(counterpartProfile, {
        mutual,
        gunaScore: compatibility?.total ?? null,
        interestStatus: interest.status,
      }),
      contact: null,
    };
  }
}
