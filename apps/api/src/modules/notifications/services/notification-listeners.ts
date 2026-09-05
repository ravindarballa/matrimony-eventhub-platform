import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import {
  NotificationChannel,
  NotificationCriticality,
  formatInr,
  type Paisa,
} from '@eventhub/contracts';

import { NotificationsService } from './notifications.service.js';

const IN_APP = [NotificationChannel.IN_APP];
const IN_APP_PUSH = [NotificationChannel.IN_APP, NotificationChannel.PUSH];
const URGENT = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
  NotificationChannel.SMS,
];

/**
 * Turns domain events into messages.
 *
 * It listens rather than being called, which is what keeps every other module
 * unaware that notifications exist: bookings, payments and matrimony emit what
 * happened, and this decides whether anyone should be told. Nothing here can
 * fail the thing that triggered it - every handler swallows its own errors,
 * because a booking must not roll back because an SMS provider was down.
 *
 * Events carry domain ids (a vendor, a profile) rather than user ids, so the
 * lookups below are deliberately raw collection reads: importing every module's
 * models to resolve one field each would make the notifier a second copy of the
 * domain, and couple it to all of them.
 */
@Injectable()
export class NotificationListeners {
  private readonly logger = new Logger(NotificationListeners.name);

  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ events

  @OnEvent('enquiry.created')
  async onEnquiryCreated(payload: {
    enquiryId: string;
    vendorIds: string[];
    category: string;
    functionDate: string;
  }): Promise<void> {
    await this.guard('enquiry.created', async () => {
      for (const vendorId of payload.vendorIds) {
        const ownerId = await this.vendorOwner(vendorId);
        if (!ownerId) continue;

        await this.notifications.send({
          userId: ownerId,
          type: 'enquiry.received',
          title: 'New enquiry',
          body: `A customer is asking about ${friendly(payload.category)} for ${date(payload.functionDate)}. You have 24 hours to quote.`,
          link: '/vendor/enquiries',
          // Response time feeds search ranking, so this one is worth an SMS.
          channels: URGENT,
          data: { enquiryId: payload.enquiryId },
        });
      }
    });
  }

  @OnEvent('quote.sent')
  async onQuoteSent(payload: {
    quoteId: string;
    enquiryId: string;
    customerId: string;
    total: number;
  }): Promise<void> {
    await this.guard('quote.sent', () =>
      this.notifications.send({
        userId: payload.customerId,
        type: 'quote.received',
        title: 'A quote arrived',
        body: `A vendor has quoted ${formatInr(payload.total as Paisa)}. Compare it against the others before it expires.`,
        link: `/customer/enquiries/${payload.enquiryId}`,
        channels: IN_APP_PUSH,
      }),
    );
  }

  @OnEvent('booking.accepted')
  async onBookingAccepted(payload: {
    bookingId: string;
    customerId: string;
    vendorId: string;
    amount: number;
  }): Promise<void> {
    await this.guard('booking.accepted', async () => {
      await this.notifications.send({
        userId: payload.customerId,
        type: 'booking.accepted',
        title: 'Your date is held for 48 hours',
        body: `Pay the advance of ${formatInr(payload.amount as Paisa)} to confirm the booking. The date is released if it is not paid in time.`,
        link: `/customer/bookings/${payload.bookingId}`,
        // Losing the date is consequential, so this ignores preferences.
        criticality: NotificationCriticality.TRANSACTIONAL,
        channels: URGENT,
      });

      const ownerId = await this.vendorOwner(payload.vendorId);
      if (ownerId) {
        await this.notifications.send({
          userId: ownerId,
          type: 'booking.accepted.vendor',
          title: 'Your quote was accepted',
          body: 'The date is held. It becomes firm once the customer pays the advance.',
          link: '/vendor/enquiries',
          channels: IN_APP_PUSH,
        });
      }
    });
  }

  @OnEvent('payment.captured')
  async onPaymentCaptured(payload: {
    paymentId: string;
    bookingId: string;
    milestone: string;
    amount: number;
    split?: { vendorNet: number };
  }): Promise<void> {
    await this.guard('payment.captured', async () => {
      const booking = await this.booking(payload.bookingId);
      if (!booking) return;

      await this.notifications.send({
        userId: booking.customerId.toString(),
        type: 'payment.captured',
        title: 'Payment received',
        body: `We have received ${formatInr(payload.amount as Paisa)} towards your booking. Your date is confirmed.`,
        link: `/customer/bookings/${payload.bookingId}`,
        criticality: NotificationCriticality.TRANSACTIONAL,
        channels: URGENT,
      });

      const ownerId = await this.vendorOwner(booking.vendorId.toString());
      if (ownerId && payload.split) {
        await this.notifications.send({
          userId: ownerId,
          type: 'payment.captured.vendor',
          title: 'Advance received',
          body: `${formatInr(payload.amount as Paisa)} was captured; ${formatInr(payload.split.vendorNet as Paisa)} is owed to you after commission and TDS.`,
          link: '/vendor/enquiries',
          criticality: NotificationCriticality.TRANSACTIONAL,
          channels: IN_APP_PUSH,
        });
      }
    });
  }

  @OnEvent('payment.failed')
  async onPaymentFailed(payload: {
    paymentId: string;
    bookingId: string;
    reason: string;
  }): Promise<void> {
    await this.guard('payment.failed', async () => {
      const booking = await this.booking(payload.bookingId);
      if (!booking) return;

      await this.notifications.send({
        userId: booking.customerId.toString(),
        type: 'payment.failed',
        title: 'Payment did not go through',
        body: `${payload.reason}. Your date is still held, but only until the advance is paid.`,
        link: `/customer/bookings/${payload.bookingId}`,
        // Nobody may opt out of this one: the date is at stake.
        criticality: NotificationCriticality.TRANSACTIONAL,
        channels: URGENT,
      });
    });
  }

  @OnEvent('booking.cancelled')
  async onBookingCancelled(payload: {
    bookingId: string;
    refundAmount: number;
  }): Promise<void> {
    await this.guard('booking.cancelled', async () => {
      const booking = await this.booking(payload.bookingId);
      if (!booking) return;

      await this.notifications.send({
        userId: booking.customerId.toString(),
        type: 'booking.cancelled',
        title: 'Booking cancelled',
        body:
          payload.refundAmount > 0
            ? `${formatInr(payload.refundAmount as Paisa)} will be refunded to the original payment method.`
            : 'No refund is due under the cancellation policy that applied.',
        link: `/customer/bookings/${payload.bookingId}`,
        criticality: NotificationCriticality.TRANSACTIONAL,
        channels: URGENT,
      });

      const ownerId = await this.vendorOwner(booking.vendorId.toString());
      if (ownerId) {
        await this.notifications.send({
          userId: ownerId,
          type: 'booking.cancelled.vendor',
          title: 'A booking was cancelled',
          body: 'The date has been released and is bookable again.',
          link: '/vendor/enquiries',
          criticality: NotificationCriticality.TRANSACTIONAL,
          channels: IN_APP_PUSH,
        });
      }
    });
  }

  @OnEvent('vendor.kyc.decided')
  async onKycDecided(payload: {
    vendorId: string;
    ownerId: string;
    status: string;
    reason?: string;
  }): Promise<void> {
    await this.guard('vendor.kyc.decided', () =>
      this.notifications.send({
        userId: payload.ownerId,
        type: 'vendor.kyc',
        title:
          payload.status === 'VERIFIED'
            ? 'You are verified'
            : 'Verification needs attention',
        body:
          payload.status === 'VERIFIED'
            ? 'You can now accept bookings and receive payouts.'
            : `${payload.reason ?? 'Something needs fixing.'} Update your details and resubmit.`,
        link: '/vendor/onboarding',
        criticality: NotificationCriticality.TRANSACTIONAL,
        channels: URGENT,
      }),
    );
  }

  @OnEvent('matrimony.interest.sent')
  async onInterestSent(payload: {
    fromProfileId: string;
    toProfileId: string;
  }): Promise<void> {
    await this.guard('matrimony.interest.sent', async () => {
      const [recipient, sender] = await Promise.all([
        this.profile(payload.toProfileId),
        this.profile(payload.fromProfileId),
      ]);
      if (!recipient || !sender) return;

      await this.notifications.send({
        userId: recipient.userId.toString(),
        type: 'matrimony.interest.received',
        title: 'Someone is interested',
        body: `${sender.displayName as string} has sent you an interest. Accepting it shares both phone numbers.`,
        link: '/matrimony/interests',
        channels: IN_APP_PUSH,
      });
    });
  }

  @OnEvent('matrimony.interest.accepted')
  async onInterestAccepted(payload: { profileIds: string[] }): Promise<void> {
    await this.guard('matrimony.interest.accepted', async () => {
      for (const profileId of payload.profileIds) {
        const profile = await this.profile(profileId);
        if (!profile) continue;

        await this.notifications.send({
          userId: profile.userId.toString(),
          type: 'matrimony.interest.accepted',
          title: 'Interest accepted',
          body: 'Contact details are now visible on both profiles.',
          link: '/matrimony/interests',
          channels: IN_APP_PUSH,
        });
      }
    });
  }

  /**
   * The handoff the whole platform is built around: a family that has just
   * fixed a match is exactly the family that needs a venue.
   */
  @OnEvent('matrimony.engaged')
  async onEngaged(payload: {
    userId: string;
    city: string;
    displayName: string;
  }): Promise<void> {
    await this.guard('matrimony.engaged', () =>
      this.notifications.send({
        userId: payload.userId,
        type: 'matrimony.engaged',
        title: 'Congratulations',
        body: `Shall we start on the wedding? Venues, caterers and photographers in ${payload.city} are a few taps away.`,
        link: '/customer/wedding',
        channels: IN_APP,
      }),
    );
  }

  // --------------------------------------------------------------- resolvers

  private async vendorOwner(vendorId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(vendorId)) return null;
    const vendor = await this.conn
      .collection('vendors')
      .findOne(
        { _id: new Types.ObjectId(vendorId) },
        { projection: { ownerId: 1 } },
      );
    return vendor?.['ownerId']?.toString() ?? null;
  }

  private async booking(
    bookingId: string,
  ): Promise<{ customerId: Types.ObjectId; vendorId: Types.ObjectId } | null> {
    if (!Types.ObjectId.isValid(bookingId)) return null;
    const booking = await this.conn
      .collection('bookings')
      .findOne(
        { _id: new Types.ObjectId(bookingId) },
        { projection: { customerId: 1, vendorId: 1 } },
      );
    return booking
      ? {
          customerId: booking['customerId'] as Types.ObjectId,
          vendorId: booking['vendorId'] as Types.ObjectId,
        }
      : null;
  }

  private async profile(
    profileId: string,
  ): Promise<{ userId: Types.ObjectId; displayName: unknown } | null> {
    if (!Types.ObjectId.isValid(profileId)) return null;
    const profile = await this.conn
      .collection('matrimony_profiles')
      .findOne(
        { _id: new Types.ObjectId(profileId) },
        { projection: { userId: 1, displayName: 1 } },
      );
    return profile
      ? {
          userId: profile['userId'] as Types.ObjectId,
          displayName: profile['displayName'],
        }
      : null;
  }

  /**
   * Every handler runs inside this. A notification failure must never surface
   * as a failure of the booking, payment or interest that caused it - those
   * have already committed by the time the event is emitted.
   */
  private async guard(event: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (e) {
      this.logger.error(`Notification handler for ${event} failed`, e as Error);
    }
  }
}

function friendly(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
