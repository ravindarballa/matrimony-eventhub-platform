import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import {
  AvailabilityStatus,
  BookingStatus,
  COMMISSION_BPS,
  DEFAULT_CANCELLATION_TIERS,
  ErrorCode,
  type BookingDto,
  type Paisa,
  type RefundPreview,
  type Role,
} from '@eventhub/contracts';

import { Booking, type BookingDocument } from '../schemas/booking.schema.js';
import { Quote, type QuoteDocument } from '../schemas/quote.schema.js';
import {
  VendorAvailability,
  type VendorAvailabilityDocument,
} from '../schemas/vendor-availability.schema.js';
import { BookingStateMachine } from './booking-state-machine.js';
import { RefundCalculator } from './refund-calculator.js';

/** MongoDB duplicate-key error. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/** Dates are stored at UTC midnight so one calendar day is one exact value. */
export const toUtcMidnight = (d: Date | string): Date => {
  const date = new Date(d);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
};

/** Advance must be paid within this window or the held slot is released. */
const ADVANCE_WINDOW_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectConnection() private readonly conn: Connection,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Quote.name) private readonly quotes: Model<QuoteDocument>,
    @InjectModel(VendorAvailability.name)
    private readonly availability: Model<VendorAvailabilityDocument>,
    private readonly machine: BookingStateMachine,
    private readonly refunds: RefundCalculator,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Accept a quote and create the booking.
   *
   * This is the one place on the platform where a race can sell the same venue
   * on the same day to two families. The guarantee is not this code being
   * careful - it is the unique partial index on (vendorId, date). Two concurrent
   * calls both reach the insert; the storage engine lets exactly one through and
   * the other gets E11000, which becomes 409 EVT_SLOT_TAKEN.
   *
   * Everything runs in one transaction, so a failure anywhere leaves no booking
   * and no held slot behind.
   */
  async acceptQuote(quoteId: string, customerId: string): Promise<BookingDto> {
    if (!Types.ObjectId.isValid(quoteId)) throw new NotFoundException();

    const session = await this.conn.startSession();
    try {
      const booking = await session.withTransaction(async () => {
        const quote = await this.quotes.findById(quoteId).session(session);
        if (!quote) throw new NotFoundException();

        if (quote.customerId.toString() !== customerId) {
          throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);
        }
        if (quote.status === 'ACCEPTED') {
          throw new ConflictException({
            code: ErrorCode.EVT_INVALID_TRANSITION,
            message: 'This quote has already been accepted.',
          });
        }
        if (quote.status !== 'SENT') {
          throw new GoneException(ErrorCode.EVT_QUOTE_EXPIRED);
        }
        if (quote.validUntil.getTime() < Date.now()) {
          throw new GoneException(ErrorCode.EVT_QUOTE_EXPIRED);
        }

        const date = toUtcMidnight(quote.functionDate);

        // The moment of truth. Under concurrency exactly one of these succeeds.
        let slot: VendorAvailabilityDocument;
        try {
          const created = await this.availability.create(
            [
              {
                vendorId: quote.vendorId,
                date,
                status: AvailabilityStatus.HELD,
              },
            ],
            { session },
          );
          slot = created[0]!;
        } catch (e) {
          if (isDuplicateKey(e)) {
            throw new ConflictException({
              code: ErrorCode.EVT_SLOT_TAKEN,
              message: 'This date was just booked. Please choose another.',
            });
          }
          throw e;
        }

        const advanceAmount = Math.round(
          (quote.total * quote.advancePercent) / 100,
        ) as Paisa;

        const created = await this.bookings.create(
          [
            {
              weddingId: quote.weddingId,
              customerId: quote.customerId,
              vendorId: quote.vendorId,
              quoteId: quote._id,
              category: quote.category,
              status: BookingStatus.ACCEPTED,
              eventDate: date,
              totalAmount: quote.total,
              paidAmount: 0,
              advanceAmount,
              // Snapshotted so later config changes cannot restate this deal.
              commissionBps: COMMISSION_BPS[quote.category],
              cancellationTiers: [...DEFAULT_CANCELLATION_TIERS],
              availabilityId: slot._id,
              advanceDueAt: new Date(Date.now() + ADVANCE_WINDOW_MS),
              statusHistory: [
                {
                  to: BookingStatus.ACCEPTED,
                  at: new Date(),
                  by: customerId,
                  reason: 'Quote accepted',
                },
              ],
            },
          ],
          { session },
        );
        const doc = created[0]!;

        slot.bookingId = doc._id;
        await slot.save({ session });

        quote.status = 'ACCEPTED';
        await quote.save({ session });

        return doc;
      });

      // Emitted after the transaction commits, so no listener can observe a
      // booking that later rolls back.
      this.events.emit('booking.accepted', {
        bookingId: booking.id,
        customerId,
        vendorId: booking.vendorId.toString(),
        amount: booking.advanceAmount,
      });

      return this.toDto(booking, ['CUSTOMER']);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Confirm on payment. Called by the payment webhook, which is the only thing
   * that may confirm a booking - a client callback is never trusted.
   */
  async confirmOnPayment(bookingId: string, amountPaid: Paisa): Promise<void> {
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        const booking = await this.bookings.findById(bookingId).session(session);
        if (!booking) throw new NotFoundException();

        // Idempotent: gateways retry, and a second delivery must be harmless.
        if (booking.status === BookingStatus.CONFIRMED) return;

        booking.paidAmount = (booking.paidAmount + amountPaid) as Paisa;
        this.machine.apply(booking, BookingStatus.CONFIRMED, {
          actorId: 'system',
          actorRoles: [],
          system: true,
          reason: 'Advance received',
        });
        await booking.save({ session });

        // Promote the hold to a firm booking.
        await this.availability.updateOne(
          { _id: booking.availabilityId },
          { $set: { status: AvailabilityStatus.BOOKED } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async refundPreview(bookingId: string, userId: string): Promise<RefundPreview> {
    const booking = await this.findOwned(bookingId, userId);
    return this.refunds.preview(booking);
  }

  /**
   * Cancel and release the date. The slot row is deleted rather than flipped to
   * AVAILABLE: the partial index only covers HELD/BOOKED, so a lingering row
   * would be invisible to the constraint anyway, and deleting keeps the
   * collection to occupied dates only.
   */
  async cancel(
    bookingId: string,
    actorId: string,
    roles: readonly Role[],
    reason?: string,
  ): Promise<{ booking: BookingDto; refund: RefundPreview }> {
    const session = await this.conn.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const booking = await this.bookings.findById(bookingId).session(session);
        if (!booking) throw new NotFoundException();

        const isCustomer = booking.customerId.toString() === actorId;
        const isAdmin = roles.includes('ADMIN');
        if (!isCustomer && !isAdmin) {
          throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN);
        }

        const refund = this.refunds.preview(booking);

        this.machine.apply(booking, BookingStatus.CANCELLED, {
          actorId,
          actorRoles: roles,
          reason,
        });
        booking.cancelledAt = new Date();
        booking.cancelledBy = actorId;
        await booking.save({ session });

        if (booking.availabilityId) {
          await this.availability.deleteOne(
            { _id: booking.availabilityId },
            { session },
          );
        }

        return { booking, refund };
      });

      this.events.emit('booking.cancelled', {
        bookingId: result.booking.id,
        refundAmount: result.refund.refundAmount,
      });

      return {
        booking: this.toDto(result.booking, roles),
        refund: result.refund,
      };
    } finally {
      await session.endSession();
    }
  }

  /**
   * Releases slots for ACCEPTED bookings whose advance never arrived. Run on a
   * schedule - without it a non-paying customer holds a date indefinitely.
   */
  async expireUnpaidHolds(now = new Date()): Promise<number> {
    const stale = await this.bookings.find({
      status: BookingStatus.ACCEPTED,
      advanceDueAt: { $lt: now },
    });

    let released = 0;
    for (const booking of stale) {
      const session = await this.conn.startSession();
      try {
        await session.withTransaction(async () => {
          this.machine.apply(booking, BookingStatus.EXPIRED, {
            actorId: 'system',
            actorRoles: [],
            system: true,
            reason: 'Advance not received within 48 hours',
          });
          await booking.save({ session });
          if (booking.availabilityId) {
            await this.availability.deleteOne(
              { _id: booking.availabilityId },
              { session },
            );
          }
        });
        released += 1;
      } catch (e) {
        // One stuck booking must not stop the sweep.
        this.logger.error(`Failed to expire booking ${booking.id}`, e as Error);
      } finally {
        await session.endSession();
      }
    }

    if (released) this.logger.log(`Released ${released} unpaid holds`);
    return released;
  }

  async findOwned(bookingId: string, userId: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException();
    // Ownership is part of the query, not a post-fetch check.
    const booking = await this.bookings.findOne({
      _id: bookingId,
      customerId: userId,
    });
    if (!booking) throw new NotFoundException();
    return booking;
  }

  toDto(booking: BookingDocument, roles: readonly Role[]): BookingDto {
    return {
      id: booking.id as string,
      weddingId: booking.weddingId.toString(),
      functionId: booking.functionId?.toString() ?? null,
      customerId: booking.customerId.toString(),
      vendorId: booking.vendorId.toString(),
      quoteId: booking.quoteId.toString(),
      category: booking.category,
      status: booking.status,
      eventDate: booking.eventDate.toISOString(),
      totalAmount: booking.totalAmount as Paisa,
      paidAmount: booking.paidAmount as Paisa,
      advanceAmount: booking.advanceAmount as Paisa,
      commissionBps: booking.commissionBps,
      cancellationTiers: booking.cancellationTiers,
      // The client renders these rather than re-deriving the rules.
      allowedTransitions: this.machine.allowedTransitions(booking, roles),
      statusHistory: booking.statusHistory.map((h) => ({
        from: h.from ?? null,
        to: h.to,
        at: h.at.toISOString(),
        by: h.by,
        reason: h.reason,
      })),
    };
  }
}
