import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import {
  AvailabilityStatus,
  BookingStatus,
  LedgerAccount,
  PaymentMilestone,
  PaymentStatus,
  type Paisa,
} from '@eventhub/contracts';

import configuration from '../src/config/configuration.js';
import { PaymentsModule } from '../src/modules/payments/payments.module.js';
import { PaymentsService } from '../src/modules/payments/services/payments.service.js';
import { LedgerService } from '../src/modules/payments/services/ledger.service.js';
import { FakeGateway } from '../src/modules/payments/gateways/fake.gateway.js';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateways/payment-gateway.interface.js';
import { Payment } from '../src/modules/payments/schemas/payment.schema.js';
import { LedgerEntry } from '../src/modules/payments/schemas/ledger-entry.schema.js';
import { WebhookEvent } from '../src/modules/payments/schemas/webhook-event.schema.js';
import { BookingsService } from '../src/modules/events/services/bookings.service.js';
import { Quote } from '../src/modules/events/schemas/quote.schema.js';
import { Booking } from '../src/modules/events/schemas/booking.schema.js';
import { VendorAvailability } from '../src/modules/events/schemas/vendor-availability.schema.js';
import type { PaymentDocument } from '../src/modules/payments/schemas/payment.schema.js';
import type { LedgerEntryDocument } from '../src/modules/payments/schemas/ledger-entry.schema.js';
import type { WebhookEventDocument } from '../src/modules/payments/schemas/webhook-event.schema.js';
import type { QuoteDocument } from '../src/modules/events/schemas/quote.schema.js';
import type { BookingDocument } from '../src/modules/events/schemas/booking.schema.js';
import type { VendorAvailabilityDocument } from '../src/modules/events/schemas/vendor-availability.schema.js';

/**
 * The payment lifecycle end to end, against a real replica set and the real
 * HMAC verification path - the fake gateway signs exactly as Razorpay does, so
 * what these tests exercise is the code that will face production traffic. The
 * only thing stubbed out is the money actually moving.
 */
describe('Payments (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let payments: PaymentsService;
  let ledger: LedgerService;
  let bookingsService: BookingsService;
  let gateway: FakeGateway;

  let paymentModel: Model<PaymentDocument>;
  let ledgerModel: Model<LedgerEntryDocument>;
  let webhookModel: Model<WebhookEventDocument>;
  let quotes: Model<QuoteDocument>;
  let bookings: Model<BookingDocument>;
  let availability: Model<VendorAvailabilityDocument>;

  const VENDOR = new Types.ObjectId();
  const WEDDING = new Types.ObjectId();
  const EVENT_DATE = new Date(Date.UTC(2027, 1, 14));
  /** Rs 5,00,000 total, 25% advance = Rs 1,25,000. */
  const TOTAL = 500_000_00;
  const ADVANCE = 125_000_00;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        PaymentsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    payments = moduleRef.get(PaymentsService);
    ledger = moduleRef.get(LedgerService);
    bookingsService = moduleRef.get(BookingsService);
    gateway = moduleRef.get<FakeGateway>(PAYMENT_GATEWAY);

    paymentModel = moduleRef.get(getModelToken(Payment.name));
    ledgerModel = moduleRef.get(getModelToken(LedgerEntry.name));
    webhookModel = moduleRef.get(getModelToken(WebhookEvent.name));
    quotes = moduleRef.get(getModelToken(Quote.name));
    bookings = moduleRef.get(getModelToken(Booking.name));
    availability = moduleRef.get(getModelToken(VendorAvailability.name));

    // The unique indexes are the guarantees under test, so they must exist.
    await Promise.all([
      paymentModel.syncIndexes(),
      ledgerModel.syncIndexes(),
      webhookModel.syncIndexes(),
      quotes.syncIndexes(),
      bookings.syncIndexes(),
      availability.syncIndexes(),
    ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      paymentModel.deleteMany({}),
      ledgerModel.deleteMany({}),
      webhookModel.deleteMany({}),
      quotes.deleteMany({}),
      bookings.deleteMany({}),
      availability.deleteMany({}),
    ]);
  });

  /** An ACCEPTED booking held by a fresh customer, ready to be paid for. */
  const acceptedBooking = async () => {
    const customerId = new Types.ObjectId();
    const quote = await quotes.create({
      enquiryId: new Types.ObjectId(),
      vendorId: VENDOR,
      weddingId: WEDDING,
      customerId,
      category: 'VENUE', // 800 bps commission
      functionDate: EVENT_DATE,
      lineItems: [
        {
          description: 'Banquet hall, full day',
          quantity: 1,
          unitPrice: TOTAL,
          lineTotal: TOTAL,
        },
      ],
      subtotal: TOTAL,
      gstAmount: 0,
      total: TOTAL,
      advancePercent: 25,
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      status: 'SENT',
    });

    const booking = await bookingsService.acceptQuote(
      quote.id,
      customerId.toString(),
    );
    return { booking, customerId: customerId.toString() };
  };

  /** Polls until the emitted domain event has been handled, or gives up. */
  const until = async <T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeoutMs = 5_000,
  ): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (done(value) || Date.now() > deadline) return value;
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  const deliver = async (body: unknown) => {
    const { rawBody, signature } = gateway.signPayload(body);
    return payments.handleWebhook(rawBody, signature);
  };

  // ---------------------------------------------------------------------------

  describe('intent', () => {
    it('prices the advance from the booking, not from the request', async () => {
      const { booking, customerId } = await acceptedBooking();

      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0001',
      );

      expect(intent.amount).toBe(ADVANCE);
      expect(intent.gatewayOrderId).toMatch(/^order_fake_/);
      expect(intent.gatewayKeyId).toBe('fake_key_local_dev');
      // The secret must never reach a DTO the browser will see.
      expect(JSON.stringify(intent)).not.toContain('webhook');
    });

    it('hands back the open intent instead of opening a second order', async () => {
      const { booking, customerId } = await acceptedBooking();

      const first = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0001',
      );
      // A different key: the customer reloaded the checkout page.
      const second = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0002',
      );

      expect(second.paymentId).toBe(first.paymentId);
      expect(await paymentModel.countDocuments()).toBe(1);
    });

    it('lets exactly one of several simultaneous checkouts create the order', async () => {
      const { booking, customerId } = await acceptedBooking();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          payments.createIntent(
            booking.id,
            PaymentMilestone.ADVANCE,
            customerId,
            'idem-key-same',
          ),
        ),
      );

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      // The unique index on idempotencyKey is what holds this line, not luck.
      expect(await paymentModel.countDocuments()).toBe(1);
    });

    it('refuses a milestone the booking status does not allow', async () => {
      const { booking, customerId } = await acceptedBooking();

      // The balance cannot be paid before the booking is confirmed.
      await expect(
        payments.createIntent(
          booking.id,
          PaymentMilestone.BALANCE,
          customerId,
          'idem-key-0003',
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('refuses to open a checkout for another customer\'s booking', async () => {
      const { booking } = await acceptedBooking();

      await expect(
        payments.createIntent(
          booking.id,
          PaymentMilestone.ADVANCE,
          new Types.ObjectId().toString(),
          'idem-key-0004',
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('closes an abandoned checkout once its window has passed', async () => {
      const { booking, customerId } = await acceptedBooking();
      await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0005',
      );

      await paymentModel.updateMany(
        {},
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      expect(await payments.expireStaleIntents()).toBe(1);
      const stored = await paymentModel.findOne();
      expect(stored!.status).toBe(PaymentStatus.FAILED);
      expect(stored!.failureReason).toBe('PAY_INTENT_EXPIRED');
    });
  });

  // ---------------------------------------------------------------------------

  describe('webhook', () => {
    it('rejects a forged signature without touching the payment', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0006',
      );

      const body = gateway.capturedEvent(
        intent.gatewayOrderId,
        ADVANCE as Paisa,
      );
      const rawBody = Buffer.from(JSON.stringify(body), 'utf8');

      await expect(
        payments.handleWebhook(rawBody, 'deadbeef'),
      ).rejects.toMatchObject({ status: 401 });

      const stored = await paymentModel.findById(intent.paymentId);
      expect(stored!.status).toBe(PaymentStatus.CREATED);
      // Nothing was even recorded as having arrived.
      expect(await webhookModel.countDocuments()).toBe(0);
    });

    it('captures the payment, confirms the booking and books the date', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0007',
      );

      const ack = await deliver(
        gateway.capturedEvent(intent.gatewayOrderId, ADVANCE as Paisa),
      );
      expect(ack).toEqual({ received: true });

      const payment = await paymentModel.findById(intent.paymentId);
      expect(payment!.status).toBe(PaymentStatus.CAPTURED);
      expect(payment!.method).toBe('upi');
      expect(payment!.paidAt).toBeInstanceOf(Date);

      const stored = await bookings.findById(booking.id);
      expect(stored!.status).toBe(BookingStatus.CONFIRMED);
      expect(stored!.paidAmount).toBe(ADVANCE);

      const slot = await availability.findOne({ vendorId: VENDOR });
      expect(slot!.status).toBe(AvailabilityStatus.BOOKED);
    });

    it('credits the booking once when the gateway delivers the same event twice', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0008',
      );

      const event = gateway.capturedEvent(intent.gatewayOrderId, ADVANCE as Paisa);
      expect(await deliver(event)).toEqual({ received: true });
      expect(await deliver(event)).toEqual({ received: true, duplicate: true });

      const stored = await bookings.findById(booking.id);
      expect(stored!.paidAmount).toBe(ADVANCE); // charged once, not twice
      // And the accounting was posted once.
      expect(await ledgerModel.countDocuments({ refType: 'payment' })).toBe(4);
    });

    it('posts a balanced double entry for the split', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0009',
      );
      await deliver(gateway.capturedEvent(intent.gatewayOrderId, ADVANCE as Paisa));

      const entries = await ledger.forBooking(booking.id);
      const debits = entries.reduce((n, e) => n + e.debit, 0);
      const credits = entries.reduce((n, e) => n + e.credit, 0);
      expect(debits).toBe(credits);

      // VENUE is 800 bps, TDS is 100 bps, on Rs 1,25,000.
      expect(await ledger.balance(LedgerAccount.ESCROW)).toBe(ADVANCE);
      expect(await ledger.balance(LedgerAccount.COMMISSION_INCOME)).toBe(-10_000_00);
      expect(await ledger.balance(LedgerAccount.TDS_PAYABLE)).toBe(-1_250_00);
      expect(await ledger.balance(LedgerAccount.VENDOR_PAYABLE)).toBe(-113_750_00);
    });

    it('credits nothing when the charged amount is not the amount we priced', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0010',
      );

      await deliver(gateway.capturedEvent(intent.gatewayOrderId, 100 as Paisa));

      const payment = await paymentModel.findById(intent.paymentId);
      expect(payment!.status).toBe(PaymentStatus.FAILED);
      expect(payment!.failureReason).toBe('PAY_AMOUNT_MISMATCH');

      const stored = await bookings.findById(booking.id);
      expect(stored!.status).toBe(BookingStatus.ACCEPTED);
      expect(stored!.paidAmount).toBe(0);
      expect(await ledgerModel.countDocuments()).toBe(0);
    });

    it('marks a declined payment failed and leaves the booking unconfirmed', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0011',
      );

      await deliver(
        gateway.failedEvent(intent.gatewayOrderId, ADVANCE as Paisa, 'Card declined'),
      );

      const payment = await paymentModel.findById(intent.paymentId);
      expect(payment!.status).toBe(PaymentStatus.FAILED);
      expect(payment!.failureReason).toBe('Card declined');

      const stored = await bookings.findById(booking.id);
      expect(stored!.status).toBe(BookingStatus.ACCEPTED);
      const slot = await availability.findOne({ vendorId: VENDOR });
      expect(slot!.status).toBe(AvailabilityStatus.HELD);
    });

    it('ignores a capture for an order it has never heard of', async () => {
      const ack = await deliver(
        gateway.capturedEvent('order_fake_unknown', ADVANCE as Paisa),
      );
      expect(ack).toEqual({ received: true });
      expect(await ledgerModel.countDocuments()).toBe(0);
    });

    it('accepts an event type it does not act on', async () => {
      const ack = await deliver({
        id: 'evt_fake_other',
        event: 'payment.authorized',
        payload: {},
      });
      expect(ack).toEqual({ received: true });
    });
  });

  // ---------------------------------------------------------------------------

  describe('balance and refunds', () => {
    /** Advance captured, so the booking is CONFIRMED and the balance is due. */
    const confirmedBooking = async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        `idem-adv-${booking.id}`,
      );
      await deliver(gateway.capturedEvent(intent.gatewayOrderId, ADVANCE as Paisa));
      return { booking, customerId, advancePaymentId: intent.paymentId };
    };

    it('prices the balance as everything still outstanding', async () => {
      const { booking, customerId } = await confirmedBooking();

      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.BALANCE,
        customerId,
        `idem-bal-${booking.id}`,
      );
      expect(intent.amount).toBe(TOTAL - ADVANCE);

      await deliver(
        gateway.capturedEvent(intent.gatewayOrderId, (TOTAL - ADVANCE) as Paisa),
      );

      const stored = await bookings.findById(booking.id);
      expect(stored!.paidAmount).toBe(TOTAL);
      expect(stored!.status).toBe(BookingStatus.CONFIRMED);
      // The advance did not confirm the booking a second time.
      expect(
        stored!.statusHistory.filter((h) => h.to === BookingStatus.CONFIRMED),
      ).toHaveLength(1);
    });

    it('refuses a milestone that is already paid in full', async () => {
      const { booking, customerId } = await confirmedBooking();

      await expect(
        payments.createIntent(
          booking.id,
          PaymentMilestone.ADVANCE,
          customerId,
          `idem-again-${booking.id}`,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('reports the schedule with the paid milestone reflected', async () => {
      const { booking, customerId } = await confirmedBooking();

      const schedule = await payments.schedule(booking.id, customerId);

      expect(schedule).toHaveLength(2);
      expect(schedule[0]).toMatchObject({
        milestone: PaymentMilestone.ADVANCE,
        amount: ADVANCE,
        status: PaymentStatus.CAPTURED,
      });
      expect(schedule[1]).toMatchObject({
        milestone: PaymentMilestone.BALANCE,
        amount: TOTAL - ADVANCE,
        status: 'NOT_DUE',
        paymentId: null,
      });
    });

    it('refunds part of a capture and reverses the split proportionally', async () => {
      const { booking, advancePaymentId } = await confirmedBooking();

      const result = await payments.refund(
        advancePaymentId,
        (ADVANCE / 2) as Paisa,
        'Goodwill',
      );
      expect(result.status).toBe('processed');

      const payment = await paymentModel.findById(advancePaymentId);
      expect(payment!.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(payment!.refundedAmount).toBe(ADVANCE / 2);
      expect(payment!.refunds).toHaveLength(1);

      const entries = await ledger.forBooking(booking.id);
      const debits = entries.reduce((n, e) => n + e.debit, 0);
      const credits = entries.reduce((n, e) => n + e.credit, 0);
      expect(debits).toBe(credits);

      // Half the money is out of escrow again, and half the commission with it.
      expect(await ledger.balance(LedgerAccount.ESCROW)).toBe(ADVANCE / 2);
      expect(await ledger.balance(LedgerAccount.COMMISSION_INCOME)).toBe(-5_000_00);
    });

    it('refuses to refund more than remains', async () => {
      const { advancePaymentId } = await confirmedBooking();

      await payments.refund(advancePaymentId, (ADVANCE - 100) as Paisa);
      await expect(
        payments.refund(advancePaymentId, 500 as Paisa),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('refuses to refund a payment that was never captured', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0012',
      );

      await expect(payments.refund(intent.paymentId)).rejects.toMatchObject({
        status: 409,
      });
    });

    /**
     * Cancelling 120 days out refunds in full under the default tiers. The
     * payments module learns of it through the domain event, so the events
     * module stays unaware that payments exist at all.
     */
    it('refunds a cancelled booking by policy, driven by the domain event', async () => {
      const { booking, customerId, advancePaymentId } = await confirmedBooking();

      const { refund } = await bookingsService.cancel(
        booking.id,
        customerId,
        ['CUSTOMER'],
        'Changed venue',
      );
      expect(refund.refundAmount).toBe(ADVANCE); // 120 days out: full refund

      // Nothing called the payments module: it listens for booking.cancelled,
      // which is what keeps the events module unaware that payments exist.
      const payment = await until(
        () => paymentModel.findById(advancePaymentId),
        (p) => p?.status === PaymentStatus.REFUNDED,
      );
      expect(payment!.status).toBe(PaymentStatus.REFUNDED);
      expect(payment!.refundedAmount).toBe(ADVANCE);

      // Escrow is empty again and the books still balance.
      expect(await ledger.balance(LedgerAccount.ESCROW)).toBe(0);
      const entries = await ledger.forBooking(booking.id);
      expect(entries.reduce((n, e) => n + e.debit - e.credit, 0)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------

  describe('reads', () => {
    it('will not show a payment to anyone but its owner', async () => {
      const { booking, customerId } = await acceptedBooking();
      const intent = await payments.createIntent(
        booking.id,
        PaymentMilestone.ADVANCE,
        customerId,
        'idem-key-0013',
      );

      await expect(
        payments.findOwned(intent.paymentId, new Types.ObjectId().toString()),
      ).rejects.toMatchObject({ status: 404 });

      const mine = await payments.findOwned(intent.paymentId, customerId);
      expect(mine.amount).toBe(ADVANCE);
    });
  });
});
