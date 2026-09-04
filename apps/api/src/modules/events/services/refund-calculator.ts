import { Injectable } from '@nestjs/common';
import {
  DEFAULT_CANCELLATION_TIERS,
  type CancellationTier,
  type Paisa,
  type RefundPreview,
} from '@eventhub/contracts';

import type { BookingDocument } from '../schemas/booking.schema.js';

/**
 * Refunds are computed here and nowhere else - never on the client, which only
 * ever displays what /refund-preview returns.
 *
 * All arithmetic is on integer paisa. The three parts are derived so they sum
 * to exactly what was paid: the last share absorbs the rounding remainder, so
 * no paisa is created or destroyed.
 */
@Injectable()
export class RefundCalculator {
  daysUntil(eventDate: Date, now = new Date()): number {
    const startOfDay = (d: Date): number =>
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.floor((startOfDay(eventDate) - startOfDay(now)) / 86_400_000);
  }

  /** The most generous tier whose threshold the cancellation date clears. */
  tierFor(
    daysBefore: number,
    tiers: readonly CancellationTier[] = DEFAULT_CANCELLATION_TIERS,
  ): CancellationTier {
    const sorted = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
    return (
      sorted.find((t) => daysBefore >= t.minDaysBefore) ??
      sorted[sorted.length - 1]!
    );
  }

  preview(booking: BookingDocument, now = new Date()): RefundPreview {
    const days = this.daysUntil(booking.eventDate, now);
    const tier = this.tierFor(days, booking.cancellationTiers);
    const paid = booking.paidAmount as Paisa;

    const refund = Math.round((paid * tier.refundPercent) / 100) as Paisa;
    const platformFee = Math.round((paid * tier.platformPercent) / 100) as Paisa;
    // The vendor takes the remainder, so the three always sum to `paid` exactly
    // regardless of how the percentages round.
    const vendorRetains = (paid - refund - platformFee) as Paisa;

    return {
      bookingId: booking.id as string,
      daysUntilEvent: days,
      tierApplied: tier,
      paidAmount: paid,
      refundAmount: refund,
      vendorRetains,
      platformFee,
    };
  }

  /** A vendor-initiated cancellation refunds the customer in full. */
  vendorCancellationPreview(booking: BookingDocument): RefundPreview {
    const paid = booking.paidAmount as Paisa;
    return {
      bookingId: booking.id as string,
      daysUntilEvent: this.daysUntil(booking.eventDate),
      tierApplied: {
        minDaysBefore: 0,
        refundPercent: 100,
        vendorPercent: 0,
        platformPercent: 0,
      },
      paidAmount: paid,
      refundAmount: paid,
      vendorRetains: 0 as Paisa,
      platformFee: 0 as Paisa,
    };
  }
}
