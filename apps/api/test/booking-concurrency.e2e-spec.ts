import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import {
  AvailabilityStatus,
  BookingStatus,
  DEFAULT_CANCELLATION_TIERS,
} from '@eventhub/contracts';

import { EventsModule } from '../src/modules/events/events.module.js';
import { BookingsService } from '../src/modules/events/services/bookings.service.js';
import { RefundCalculator } from '../src/modules/events/services/refund-calculator.js';
import { BookingStateMachine } from '../src/modules/events/services/booking-state-machine.js';
import { Quote } from '../src/modules/events/schemas/quote.schema.js';
import { Booking } from '../src/modules/events/schemas/booking.schema.js';
import { VendorAvailability } from '../src/modules/events/schemas/vendor-availability.schema.js';
import type { QuoteDocument } from '../src/modules/events/schemas/quote.schema.js';
import type { BookingDocument } from '../src/modules/events/schemas/booking.schema.js';
import type { VendorAvailabilityDocument } from '../src/modules/events/schemas/vendor-availability.schema.js';

describe('Booking slot lock (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let service: BookingsService;
  let quotes: Model<QuoteDocument>;
  let bookings: Model<BookingDocument>;
  let availability: Model<VendorAvailabilityDocument>;

  const VENDOR = new Types.ObjectId();
  const WEDDING = new Types.ObjectId();
  /** 120 days out, so the default tier gives a full refund. */
  const EVENT_DATE = new Date(Date.UTC(2027, 1, 14));

  beforeAll(async () => {
    // A replica set is required: withTransaction() does not work on standalone.
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        EventsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    service = moduleRef.get(BookingsService);
    quotes = moduleRef.get<Model<QuoteDocument>>(getModelToken(Quote.name));
    bookings = moduleRef.get<Model<BookingDocument>>(getModelToken(Booking.name));
    availability = moduleRef.get<Model<VendorAvailabilityDocument>>(
      getModelToken(VendorAvailability.name),
    );

    // Indexes are what enforce the lock, so they must exist before we test it.
    await Promise.all([
      availability.syncIndexes(),
      bookings.syncIndexes(),
      quotes.syncIndexes(),
    ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      quotes.deleteMany({}),
      bookings.deleteMany({}),
      availability.deleteMany({}),
    ]);
  });

  /** A quote from `VENDOR` for `EVENT_DATE`, held by a distinct customer. */
  const makeQuote = async (customerId: Types.ObjectId, total = 500_000_00) =>
    quotes.create({
      enquiryId: new Types.ObjectId(),
      vendorId: VENDOR,
      weddingId: WEDDING,
      customerId,
      category: 'VENUE',
      functionDate: EVENT_DATE,
      lineItems: [
        { description: 'Banquet hall, full day', quantity: 1, unitPrice: total, lineTotal: total },
      ],
      subtotal: total,
      gstAmount: 0,
      total,
      advancePercent: 25,
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      status: 'SENT',
    });

  it('creates the booking and holds the date on a clean acceptance', async () => {
    const customer = new Types.ObjectId();
    const quote = await makeQuote(customer);

    const booking = await service.acceptQuote(quote.id, customer.toString());

    expect(booking.status).toBe(BookingStatus.ACCEPTED);
    // 25% advance on Rs 5,00,000 = Rs 1,25,000 = 12_500_000 paisa
    expect(booking.advanceAmount).toBe(12_500_000);
    expect(booking.commissionBps).toBe(800); // VENUE

    const slots = await availability.find({ vendorId: VENDOR });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.status).toBe(AvailabilityStatus.HELD);
  });

  /**
   * The test this module exists for. Eight customers accept quotes for the same
   * vendor on the same date at the same instant. Exactly one must win.
   */
  it('lets exactly ONE of 8 simultaneous acceptances win the date', async () => {
    const customers = Array.from({ length: 8 }, () => new Types.ObjectId());
    const created = await Promise.all(customers.map((c) => makeQuote(c)));

    const results = await Promise.allSettled(
      created.map((q, i) => service.acceptQuote(q.id, customers[i]!.toString())),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(7);

    // Every loser must get the specific, actionable conflict - not a 500.
    for (const l of lost) {
      const err = (l as PromiseRejectedResult).reason as {
        response?: { code?: string };
        status?: number;
      };
      expect(err.status).toBe(409);
      expect(err.response?.code).toBe('EVT_SLOT_TAKEN');
    }

    // And the database must agree: one booking, one held slot, one accepted quote.
    expect(await bookings.countDocuments()).toBe(1);
    expect(await availability.countDocuments({ vendorId: VENDOR })).toBe(1);
    expect(await quotes.countDocuments({ status: 'ACCEPTED' })).toBe(1);
  }, 60_000);

  it('leaves no orphaned hold behind when acceptance fails', async () => {
    const customer = new Types.ObjectId();
    const quote = await makeQuote(customer);
    quote.validUntil = new Date(Date.now() - 1000); // already expired
    await quote.save();

    await expect(
      service.acceptQuote(quote.id, customer.toString()),
    ).rejects.toMatchObject({ status: 410 });

    // The transaction rolled back, so nothing was left holding the date.
    expect(await availability.countDocuments()).toBe(0);
    expect(await bookings.countDocuments()).toBe(0);
  });

  it('refuses to accept a quote belonging to another customer', async () => {
    const owner = new Types.ObjectId();
    const attacker = new Types.ObjectId();
    const quote = await makeQuote(owner);

    await expect(
      service.acceptQuote(quote.id, attacker.toString()),
    ).rejects.toMatchObject({ status: 403 });

    expect(await availability.countDocuments()).toBe(0);
  });

  it('frees the date again after cancellation', async () => {
    const first = new Types.ObjectId();
    const q1 = await makeQuote(first);
    const booking = await service.acceptQuote(q1.id, first.toString());

    // A second customer cannot have the date while it is held.
    const second = new Types.ObjectId();
    const q2 = await makeQuote(second);
    await expect(
      service.acceptQuote(q2.id, second.toString()),
    ).rejects.toMatchObject({ status: 409 });

    await service.cancel(booking.id, first.toString(), ['CUSTOMER'], 'Changed venue');

    // Now it is available again.
    const q3 = await makeQuote(second);
    const rebooked = await service.acceptQuote(q3.id, second.toString());
    expect(rebooked.status).toBe(BookingStatus.ACCEPTED);
    expect(await availability.countDocuments({ vendorId: VENDOR })).toBe(1);
  });

  it('confirms idempotently when the payment webhook is delivered twice', async () => {
    const customer = new Types.ObjectId();
    const quote = await makeQuote(customer);
    const booking = await service.acceptQuote(quote.id, customer.toString());

    await service.confirmOnPayment(booking.id, 12_500_000 as never);
    await service.confirmOnPayment(booking.id, 12_500_000 as never); // retry

    const stored = await bookings.findById(booking.id);
    expect(stored!.status).toBe(BookingStatus.CONFIRMED);
    // Charged once, not twice.
    expect(stored!.paidAmount).toBe(12_500_000);

    const slot = await availability.findOne({ vendorId: VENDOR });
    expect(slot!.status).toBe(AvailabilityStatus.BOOKED);
  });

  it('releases the hold when the advance is never paid', async () => {
    const customer = new Types.ObjectId();
    const quote = await makeQuote(customer);
    const booking = await service.acceptQuote(quote.id, customer.toString());

    // Pretend the 48-hour window has passed.
    await bookings.updateOne(
      { _id: booking.id },
      { $set: { advanceDueAt: new Date(Date.now() - 1000) } },
    );

    expect(await service.expireUnpaidHolds()).toBe(1);

    const stored = await bookings.findById(booking.id);
    expect(stored!.status).toBe(BookingStatus.EXPIRED);
    expect(await availability.countDocuments()).toBe(0);
  });
});

describe('Refund tiers', () => {
  const calc = new RefundCalculator();
  const at = (days: number) =>
    ({
      id: 'b1',
      eventDate: new Date(Date.now() + days * 86_400_000),
      paidAmount: 100_000_00, // Rs 1,00,000
      cancellationTiers: [...DEFAULT_CANCELLATION_TIERS],
    }) as never;

  it.each([
    [120, 100_000_00, 0],
    [75, 75_000_00, 20_000_00],
    [45, 50_000_00, 45_000_00],
    [20, 25_000_00, 70_000_00],
    [5, 0, 95_000_00],
  ])('at %i days: refunds %i paisa, vendor keeps %i', (days, refund, vendor) => {
    const p = calc.preview(at(days));
    expect(p.refundAmount).toBe(refund);
    expect(p.vendorRetains).toBe(vendor);
  });

  it('always splits the paid amount exactly, with no paisa created or lost', () => {
    for (const days of [120, 75, 45, 20, 5]) {
      const p = calc.preview(at(days));
      expect(p.refundAmount + p.vendorRetains + p.platformFee).toBe(p.paidAmount);
    }
  });
});

describe('Booking state machine', () => {
  const machine = new BookingStateMachine();
  const booking = (status: BookingStatus) =>
    ({ status, statusHistory: [] }) as never;

  it('permits only transitions in the table', () => {
    expect(machine.canTransition(BookingStatus.ACCEPTED, BookingStatus.CONFIRMED)).toBe(true);
    expect(machine.canTransition(BookingStatus.ACCEPTED, BookingStatus.COMPLETED)).toBe(false);
    expect(machine.canTransition(BookingStatus.CANCELLED, BookingStatus.CONFIRMED)).toBe(false);
  });

  it('rejects a jump straight from accepted to completed', () => {
    expect(() =>
      machine.apply(booking(BookingStatus.ACCEPTED), BookingStatus.COMPLETED, {
        actorId: 'u1',
        actorRoles: ['ADMIN'],
      }),
    ).toThrow();
  });

  it('stops a vendor signing off their own work', () => {
    expect(() =>
      machine.apply(booking(BookingStatus.IN_PROGRESS), BookingStatus.COMPLETED, {
        actorId: 'v1',
        actorRoles: ['VENDOR_OWNER'],
      }),
    ).toThrow();
  });

  it('offers a customer only the actions they may actually take', () => {
    const allowed = machine.allowedTransitions(
      booking(BookingStatus.CONFIRMED),
      ['CUSTOMER'],
    );
    expect(allowed).toContain(BookingStatus.CANCELLED);
    expect(allowed).not.toContain(BookingStatus.IN_PROGRESS);
  });
});
