import { ConflictException, Injectable } from '@nestjs/common';
import {
  BOOKING_TRANSITIONS,
  BookingStatus,
  ErrorCode,
  type Role,
} from '@eventhub/contracts';

import type { BookingDocument } from '../schemas/booking.schema.js';

/** Who is permitted to drive each transition. */
const TRANSITION_ACTORS: Partial<
  Record<BookingStatus, Partial<Record<BookingStatus, Role[]>>>
> = {
  ACCEPTED: {
    CONFIRMED: ['ADMIN'], // normally the payment webhook, not a person
    CANCELLED: ['CUSTOMER', 'VENDOR_OWNER', 'ADMIN'],
    EXPIRED: ['ADMIN'],
  },
  CONFIRMED: {
    IN_PROGRESS: ['ADMIN', 'VENDOR_OWNER'],
    CANCELLED: ['CUSTOMER', 'VENDOR_OWNER', 'ADMIN'],
  },
  IN_PROGRESS: {
    COMPLETED: ['CUSTOMER', 'ADMIN'], // customer signs the work off
    DISPUTED: ['CUSTOMER', 'VENDOR_OWNER', 'ADMIN'],
  },
  COMPLETED: { DISPUTED: ['CUSTOMER', 'VENDOR_OWNER', 'ADMIN'] },
  DISPUTED: { COMPLETED: ['ADMIN'], CANCELLED: ['ADMIN'] },
};

export interface TransitionContext {
  actorId: string;
  actorRoles: readonly Role[];
  reason?: string;
  /** Set by the payment webhook, which acts with no human actor. */
  system?: boolean;
}

/**
 * The ONLY thing permitted to write booking.status.
 *
 * Centralising it means the rules exist once. Services call `apply`; nothing
 * else assigns to `status`, so the set of reachable states is exactly the table
 * in BOOKING_TRANSITIONS, and the client can render actions from
 * `allowedTransitions` instead of re-deriving the rules and drifting from them.
 */
@Injectable()
export class BookingStateMachine {
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    return BOOKING_TRANSITIONS[from].includes(to);
  }

  /** What this actor may do next - drives the UI action bar. */
  allowedTransitions(
    booking: BookingDocument,
    roles: readonly Role[],
  ): BookingStatus[] {
    return BOOKING_TRANSITIONS[booking.status].filter((to) => {
      const allowed = TRANSITION_ACTORS[booking.status]?.[to];
      return !allowed || allowed.some((r) => roles.includes(r));
    });
  }

  /**
   * Mutates the document in memory and appends history. The caller is
   * responsible for saving it - usually inside the same transaction as whatever
   * else the transition implies.
   */
  apply(
    booking: BookingDocument,
    to: BookingStatus,
    ctx: TransitionContext,
  ): BookingDocument {
    const from = booking.status;

    if (from === to) {
      throw new ConflictException(ErrorCode.EVT_INVALID_TRANSITION);
    }
    if (!this.canTransition(from, to)) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: `A booking cannot go from ${from} to ${to}.`,
      });
    }

    if (!ctx.system) {
      const allowed = TRANSITION_ACTORS[from]?.[to];
      if (allowed && !allowed.some((r) => ctx.actorRoles.includes(r))) {
        throw new ConflictException({
          code: ErrorCode.EVT_INVALID_TRANSITION,
          message: 'You are not permitted to make that change.',
        });
      }
    }

    booking.status = to;
    booking.statusHistory.push({
      from,
      to,
      at: new Date(),
      by: ctx.system ? 'system' : ctx.actorId,
      reason: ctx.reason,
    });

    return booking;
  }
}
