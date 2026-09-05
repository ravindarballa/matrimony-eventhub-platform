import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode, InterestStatus } from '@eventhub/contracts';

import {
  Block,
  Interest,
  Shortlist,
  type BlockDocument,
  type InterestDocument,
  type ShortlistDocument,
} from '../schemas/matrimony-social.schema.js';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/**
 * Everything one profile can be to another: blocked, shortlisted, or the
 * subject of an interest.
 *
 * It exists as its own service so that profiles, search and interests can all
 * ask the same questions without importing one another. In particular the block
 * check has exactly one implementation - a second copy that forgot to check the
 * reverse direction would quietly turn blocking into a one-way filter.
 */
@Injectable()
export class RelationsService {
  constructor(
    @InjectModel(Interest.name) private readonly interests: Model<InterestDocument>,
    @InjectModel(Shortlist.name) private readonly shortlists: Model<ShortlistDocument>,
    @InjectModel(Block.name) private readonly blocks: Model<BlockDocument>,
  ) {}

  // -------------------------------------------------------------------- blocks

  /**
   * Every profile this one can never see, in either direction.
   *
   * Blocking has to be symmetric in effect: if it only hid the blocker from the
   * blocked, the blocked party would still be able to browse and message, and
   * the block would be worse than useless because it would feel like safety
   * without being it.
   */
  async blockedIds(profileId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const rows = await this.blocks.find({
      $or: [{ blockerId: profileId }, { blockedId: profileId }],
    });

    const key = profileId.toString();
    return rows.map((r) =>
      r.blockerId.toString() === key ? r.blockedId : r.blockerId,
    );
  }

  async isBlocked(
    a: Types.ObjectId,
    b: Types.ObjectId,
  ): Promise<boolean> {
    const found = await this.blocks.exists({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    });
    return found !== null;
  }

  async block(
    blockerId: Types.ObjectId,
    blockedId: Types.ObjectId,
    reason?: string,
  ): Promise<void> {
    if (blockerId.equals(blockedId)) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You cannot block yourself.',
      });
    }

    try {
      await this.blocks.create({ blockerId, blockedId, reason });
    } catch (e) {
      // Blocking twice is not an error; the outcome is what was asked for.
      if (!isDuplicateKey(e)) throw e;
    }

    // Any outstanding interest between the two is withdrawn, so neither side is
    // left with a pending request from someone they can no longer see.
    await this.interests.updateMany(
      {
        $or: [
          { fromProfileId: blockerId, toProfileId: blockedId },
          { fromProfileId: blockedId, toProfileId: blockerId },
        ],
        status: InterestStatus.SENT,
      },
      { $set: { status: InterestStatus.WITHDRAWN, respondedAt: new Date() } },
    );
  }

  async unblock(
    blockerId: Types.ObjectId,
    blockedId: Types.ObjectId,
  ): Promise<void> {
    await this.blocks.deleteOne({ blockerId, blockedId });
  }

  // ---------------------------------------------------------------- shortlists

  async shortlist(
    profileId: Types.ObjectId,
    targetProfileId: Types.ObjectId,
    note?: string,
  ): Promise<void> {
    if (profileId.equals(targetProfileId)) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You cannot shortlist your own profile.',
      });
    }

    // Upsert: adding twice updates the note rather than failing.
    await this.shortlists.updateOne(
      { profileId, targetProfileId },
      { $set: { note } },
      { upsert: true },
    );
  }

  async removeShortlist(
    profileId: Types.ObjectId,
    targetProfileId: Types.ObjectId,
  ): Promise<void> {
    const result = await this.shortlists.deleteOne({ profileId, targetProfileId });
    if (result.deletedCount === 0) throw new NotFoundException();
  }

  async listShortlist(profileId: Types.ObjectId): Promise<ShortlistDocument[]> {
    return this.shortlists.find({ profileId }).sort({ createdAt: -1 });
  }

  /** Which of these targets the viewer has already saved. */
  async shortlistedAmong(
    profileId: Types.ObjectId,
    targets: Types.ObjectId[],
  ): Promise<Set<string>> {
    if (!targets.length) return new Set();
    const rows = await this.shortlists.find({
      profileId,
      targetProfileId: { $in: targets },
    });
    return new Set(rows.map((r) => r.targetProfileId.toString()));
  }

  // ----------------------------------------------------------------- interests

  /** The viewer's own interest toward each of these profiles, if any. */
  async interestsFrom(
    profileId: Types.ObjectId,
    targets: Types.ObjectId[],
  ): Promise<Map<string, InterestStatus>> {
    if (!targets.length) return new Map();
    const rows = await this.interests.find({
      fromProfileId: profileId,
      toProfileId: { $in: targets },
    });
    return new Map(rows.map((r) => [r.toProfileId.toString(), r.status]));
  }

  /**
   * Whether these two have accepted each other's interest - the single
   * condition that unlocks contact details, in either direction.
   */
  async hasMutualAcceptance(
    a: Types.ObjectId,
    b: Types.ObjectId,
  ): Promise<boolean> {
    const found = await this.interests.exists({
      status: InterestStatus.ACCEPTED,
      $or: [
        { fromProfileId: a, toProfileId: b },
        { fromProfileId: b, toProfileId: a },
      ],
    });
    return found !== null;
  }

  async interestBetween(
    from: Types.ObjectId,
    to: Types.ObjectId,
  ): Promise<InterestDocument | null> {
    return this.interests.findOne({ fromProfileId: from, toProfileId: to });
  }
}
