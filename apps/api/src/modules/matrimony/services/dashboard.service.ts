import { Injectable } from '@nestjs/common';
import { PlanCode, profileDisplayId } from '@eventhub/contracts';
import type { EntitlementsDto, MatrimonyDashboardDto } from '@eventhub/contracts';

import { ProfilesService } from './profiles.service.js';
import { RelationsService } from './relations.service.js';
import { InterestsService } from './interests.service.js';
import { ChatService } from './chat.service.js';
import { EntitlementsService } from '../../subscriptions/services/entitlements.service.js';

/**
 * The one screen that answers "is anything waiting for me?".
 *
 * It composes rather than queries: every number here already had an owner
 * elsewhere, and a dashboard that reimplemented the counts would be a second
 * definition of "accepted" or "unread" free to drift from the first. What it
 * adds is running them concurrently and returning them together, so the
 * member's first screen costs one request rather than five.
 *
 * A member with no profile is answered with zeroes and a null profile rather
 * than a 404. This is precisely the screen that should explain what to do next,
 * so it must not be a screen that refuses to load until you have already done
 * it - which is the trap the search page fell into.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly relations: RelationsService,
    private readonly interests: InterestsService,
    private readonly chat: ChatService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async summary(userId: string): Promise<MatrimonyDashboardDto> {
    // One read, reused: the document for the relation counts, the DTO for the
    // header. Asking for both separately would be two queries for one profile.
    const own = await this.profiles.requireOwn(userId).catch(() => null);

    // A plan belongs to the user, not the profile, so this is answerable even
    // before a profile exists - and the free daily allowance is worth showing
    // to someone still deciding whether to finish signing up.
    const entitlements: EntitlementsDto = own
      ? await this.interests.remainingQuota(userId)
      : await this.entitlements.snapshot(userId);

    const plan = {
      code: entitlements.plan ?? PlanCode.FREE,
      name: entitlements.planName,
      isPaid: entitlements.isPaid,
      expiresAt: entitlements.subscription?.currentPeriodEnd ?? null,
      daysLeft: entitlements.subscription?.daysRemaining ?? null,
    };

    if (!own) {
      return {
        profile: null,
        interests: {
          received: 0,
          awaitingReply: 0,
          accepted: 0,
          declined: 0,
          sentToday: 0,
          dailyLimit: entitlements.interests.limit,
        },
        shortlist: { saved: 0, savedBy: 0 },
        chat: { threads: 0, unread: 0 },
        plan,
      };
    }

    const mine = this.profiles.toOwnDto(own);
    const [relations, chat] = await Promise.all([
      this.relations.counts(own._id),
      this.chat.counts(userId),
    ]);

    return {
      profile: {
        id: mine.id,
        displayId: profileDisplayId(mine.id),
        displayName: mine.displayName,
        status: mine.status,
        completeness: mine.completeness,
        // The owner sees their own photo whether or not moderation has cleared
        // it, so the primary one is taken directly rather than through the
        // visibility rules that apply to everybody else.
        photoUrl:
          (mine.photos.find((p) => p.isPrimary) ?? mine.photos[0])?.url ?? null,
        verified: mine.verified,
      },
      interests: {
        received: relations.received,
        awaitingReply: relations.awaitingReply,
        accepted: relations.accepted,
        declined: relations.declined,
        sentToday: entitlements.interests.used,
        dailyLimit: entitlements.interests.limit,
      },
      shortlist: {
        saved: relations.shortlistSaved,
        savedBy: relations.shortlistSavedBy,
      },
      chat,
      plan,
    };
  }
}
