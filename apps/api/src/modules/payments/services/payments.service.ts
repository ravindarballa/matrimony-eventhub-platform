import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import {
  BookingStatus,
  ErrorCode,
  GatewayEvent,
  GST_BPS,
  PLANS,
  PaymentMilestone,
  PaymentStatus,
  PlanCode,
  type Paisa,
  type PaymentDto,
  type PaymentIntentDto,
  type Plan,
  type PaymentScheduleEntry,
  type SubscriptionIntentDto,
  type RefundDto,
  type WebhookAck,
} from '@eventhub/contracts';

import { EntitlementsService } from '../../subscriptions/services/entitlements.service.js';
import { BookingsService } from '../../events/services/bookings.service.js';
import type { BookingDocument } from '../../events/schemas/booking.schema.js';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type VerifiedWebhook,
} from '../gateways/payment-gateway.interface.js';
import { FakeGateway } from '../gateways/fake.gateway.js';
import { Payment, type PaymentDocument } from '../schemas/payment.schema.js';
import {
  WebhookEvent,
  type WebhookEventDocument,
} from '../schemas/webhook-event.schema.js';
import { CommissionService } from './commission.service.js';
import { LedgerService } from './ledger.service.js';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/** A checkout the customer never completed stops being valid after this long. */
const INTENT_TTL_MS = 15 * 60 * 1000;

/** The balance falls due this many days before the event. */
const BALANCE_DUE_DAYS_BEFORE = 7;

/** Statuses from which a milestone may still be paid. */
const PAYABLE_STATUSES: Record<PaymentMilestone, BookingStatus[]> = {
  ADVANCE: [BookingStatus.ACCEPTED],
  BALANCE: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS],
  INSTALMENT: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS],
};

/**
 * A payment that is definitely for a booking.
 *
 * The schema makes the booking fields conditional on `purpose`, so this guard
 * is what lets the booking paths keep their types instead of asserting with `!`
 * at every use - and it fails loudly if a subscription payment ever reaches
 * code that assumes a vendor.
 */
type BookingPayment = PaymentDocument & {
  bookingId: Types.ObjectId;
  vendorId: Types.ObjectId;
  commissionBps: number;
  milestone: PaymentMilestone;
};

function asBookingPayment(payment: PaymentDocument): BookingPayment {
  if (
    payment.purpose !== 'BOOKING' ||
    !payment.bookingId ||
    !payment.vendorId ||
    payment.commissionBps === undefined ||
    !payment.milestone
  ) {
    throw new ConflictException({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'That payment is not a booking payment.',
    });
  }
  return payment as BookingPayment;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectConnection() private readonly conn: Connection,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(WebhookEvent.name)
    private readonly webhookEvents: Model<WebhookEventDocument>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly bookings: BookingsService,
    private readonly entitlements: EntitlementsService,
    private readonly commission: CommissionService,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Intent
  // ---------------------------------------------------------------------------

  /**
   * Opens a checkout for one milestone of a booking.
   *
   * The amount is derived from the booking here and never taken from the
   * request - a client that asks to pay Rs 1 for a Rs 5,00,000 wedding gets the
   * Rs 5,00,000 order back. Two things keep a double-click from becoming two
   * gateway orders: an open intent for the same milestone is handed back as-is,
   * and the unique index on idempotencyKey catches the concurrent case that
   * check cannot see.
   */
  async createIntent(
    bookingId: string,
    milestone: PaymentMilestone,
    customerId: string,
    idempotencyKey: string,
  ): Promise<PaymentIntentDto> {
    const booking = await this.bookings.findOwned(bookingId, customerId);

    if (!PAYABLE_STATUSES[milestone].includes(booking.status)) {
      throw new ConflictException({
        code: ErrorCode.EVT_INVALID_TRANSITION,
        message: `A ${milestone.toLowerCase()} cannot be paid while the booking is ${booking.status}.`,
      });
    }

    const amount = this.amountDue(booking, milestone);
    if (amount <= 0) {
      throw new ConflictException({
        code: ErrorCode.PAY_NOTHING_DUE,
        message: 'This milestone has already been paid in full.',
      });
    }

    // An intent the customer abandoned mid-checkout is reusable until it
    // expires, so returning to the page does not open a second order.
    const open = await this.payments.findOne({
      bookingId: booking._id,
      milestone,
      status: { $in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
      amount,
      expiresAt: { $gt: new Date() },
    });
    if (open) return this.toIntent(open);

    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    const order = await this.gateway.createOrder({
      amount,
      receipt: `bk_${booking.id as string}_${milestone.toLowerCase()}`,
      notes: { bookingId: booking.id as string, milestone },
    });

    try {
      const created = await this.payments.create({
        bookingId: booking._id,
        customerId: new Types.ObjectId(customerId),
        vendorId: booking.vendorId,
        commissionBps: booking.commissionBps,
        milestone,
        amount,
        status: PaymentStatus.CREATED,
        gatewayOrderId: order.orderId,
        idempotencyKey,
        expiresAt,
      });
      return this.toIntent(created);
    } catch (e) {
      if (isDuplicateKey(e)) {
        // A concurrent request with the same key won. Hand back what it made
        // rather than opening a second order.
        const existing = await this.payments.findOne({ idempotencyKey });
        if (existing) return this.toIntent(existing);
      }
      throw e;
    }
  }

  /**
   * What is owed for a milestone right now. ADVANCE is capped at the agreed
   * advance; BALANCE is everything still outstanding.
   */
  private amountDue(booking: BookingDocument, milestone: PaymentMilestone): Paisa {
    const target =
      milestone === PaymentMilestone.ADVANCE
        ? booking.advanceAmount
        : booking.totalAmount;
    return Math.max(0, target - booking.paidAmount) as Paisa;
  }

  /**
   * Opens a checkout for a plan.
   *
   * The price comes from the plan table, never from the request - the same rule
   * the booking side follows, for the same reason. GST is added on top rather
   * than carved out, so the member sees one number to pay and the books can
   * keep the platform's share separate from the government's.
   */
  async createSubscriptionIntent(
    userId: string,
    planCode: PlanCode,
    idempotencyKey: string,
  ): Promise<SubscriptionIntentDto> {
    const plan = PLANS[planCode];
    if (!plan || plan.code === PlanCode.FREE) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'That is not a plan that can be bought.',
      });
    }

    const net = plan.price;
    const gst = Math.round((net * GST_BPS) / 10_000) as Paisa;
    const gross = (net + gst) as Paisa;

    // An abandoned checkout for the same plan is reusable until it expires.
    const open = await this.payments.findOne({
      customerId: new Types.ObjectId(userId),
      purpose: 'SUBSCRIPTION',
      planCode,
      status: { $in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
      expiresAt: { $gt: new Date() },
    });
    if (open) return this.toSubscriptionIntent(open, plan);

    const order = await this.gateway.createOrder({
      amount: gross,
      receipt: `sub_${userId}_${planCode.toLowerCase()}`,
      notes: { userId, plan: planCode },
    });

    try {
      const created = await this.payments.create({
        purpose: 'SUBSCRIPTION',
        customerId: new Types.ObjectId(userId),
        planCode,
        amount: gross,
        gstAmount: gst,
        status: PaymentStatus.CREATED,
        gatewayOrderId: order.orderId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      });
      return this.toSubscriptionIntent(created, plan);
    } catch (e) {
      if (isDuplicateKey(e)) {
        const existing = await this.payments.findOne({ idempotencyKey });
        if (existing) return this.toSubscriptionIntent(existing, plan);
      }
      throw e;
    }
  }

  private toSubscriptionIntent(
    payment: PaymentDocument,
    plan: Plan,
  ): SubscriptionIntentDto {
    const gst = (payment.gstAmount ?? 0) as Paisa;
    return {
      paymentId: payment.id as string,
      gatewayOrderId: payment.gatewayOrderId,
      gatewayKeyId: this.gateway.publishableKey(),
      currency: 'INR',
      quote: {
        planCode: plan.code,
        planName: plan.name,
        net: (payment.amount - gst) as Paisa,
        gst,
        gross: payment.amount as Paisa,
        durationDays: plan.durationDays,
      },
      expiresAt: payment.expiresAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  /**
   * The only path that may move money in our records.
   *
   * Order matters and is deliberate: verify the signature against the raw body
   * first, then claim the delivery, then act. The claim is inserted before the
   * work and removed if the work throws, which is what makes a gateway retry
   * after a crash do the right thing - a delivery we half-processed is retried,
   * a delivery we finished is not.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<WebhookAck> {
    const verified = this.gateway.verifyWebhook(rawBody, signature);

    let claim: WebhookEventDocument;
    try {
      claim = await this.webhookEvents.create({
        gateway: this.gateway.name,
        eventId: verified.eventId,
        event: verified.event,
        gatewayOrderId: verified.orderId,
        payload: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
      });
    } catch (e) {
      if (isDuplicateKey(e)) {
        this.logger.debug(`Ignoring replayed webhook ${verified.eventId}`);
        return { received: true, duplicate: true };
      }
      throw e;
    }

    try {
      await this.dispatch(verified);
      claim.processedAt = new Date();
      await claim.save();
      return { received: true };
    } catch (e) {
      // Release the claim so the gateway's retry is allowed to try again.
      await this.webhookEvents.deleteOne({ _id: claim._id });
      throw e;
    }
  }

  private async dispatch(verified: VerifiedWebhook): Promise<void> {
    switch (verified.event) {
      case GatewayEvent.PAYMENT_CAPTURED:
        await this.onCaptured(verified);
        return;
      case GatewayEvent.PAYMENT_FAILED:
        await this.onFailed(verified);
        return;
      case GatewayEvent.REFUND_PROCESSED:
        await this.onRefundProcessed(verified);
        return;
      default:
        // Gateways send far more than we subscribe to. Accepting quietly is
        // correct - retrying an event we will never handle is not.
        this.logger.debug(`Ignoring unhandled gateway event ${verified.event}`);
    }
  }

  private async onCaptured(verified: VerifiedWebhook): Promise<void> {
    const payment = await this.payments.findOne({
      gatewayOrderId: verified.orderId,
    });
    if (!payment) {
      this.logger.warn(
        `Capture for unknown order ${verified.orderId ?? '(none)'} - ignoring`,
      );
      return;
    }

    if (payment.status === PaymentStatus.CAPTURED) return;

    // The gateway is the authority on what was charged. If it does not match
    // what we asked for, nothing is credited and the payment is quarantined for
    // support - crediting an amount we did not price would be worse than
    // failing loudly here.
    if (verified.amount !== undefined && verified.amount !== payment.amount) {
      this.logger.error(
        `Amount mismatch on ${payment.id as string}: charged ${verified.amount}, expected ${payment.amount}`,
      );
      payment.status = PaymentStatus.FAILED;
      payment.failureReason = ErrorCode.PAY_AMOUNT_MISMATCH;
      await payment.save();
      this.events.emit('payment.mismatch', {
        paymentId: payment.id as string,
        expected: payment.amount,
        charged: verified.amount,
      });
      return;
    }

    if (payment.purpose === 'SUBSCRIPTION') {
      await this.captureSubscription(payment, verified);
      return;
    }

    const booking = asBookingPayment(payment);
    const split = this.commission.split(
      booking.amount as Paisa,
      booking.commissionBps,
    );

    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        booking.status = PaymentStatus.CAPTURED;
        booking.gatewayPaymentId = verified.paymentId;
        booking.method = verified.method;
        booking.paidAt = new Date();
        await booking.save({ session });

        await this.ledger.postCapture(split, {
          paymentId: booking._id,
          bookingId: booking.bookingId,
          vendorId: booking.vendorId,
          session,
        });

        // Same transaction as the ledger: a confirmed booking with no
        // accounting behind it, or the reverse, must not be possible.
        await this.bookings.applyCapture(
          booking.bookingId.toString(),
          booking.amount as Paisa,
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    this.events.emit('payment.captured', {
      paymentId: booking.id as string,
      bookingId: booking.bookingId.toString(),
      milestone: booking.milestone,
      amount: booking.amount,
      split,
    });
  }

  /**
   * A captured subscription payment: bank the money and start the period.
   *
   * The ledger entry and the subscription start in one transaction, because a
   * member who paid and got no plan, or a plan nobody paid for, are both
   * expensive to discover later.
   */
  private async captureSubscription(
    payment: PaymentDocument,
    verified: VerifiedWebhook,
  ): Promise<void> {
    const gst = (payment.gstAmount ?? 0) as Paisa;
    const net = (payment.amount - gst) as Paisa;

    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        payment.status = PaymentStatus.CAPTURED;
        payment.gatewayPaymentId = verified.paymentId;
        payment.method = verified.method;
        payment.paidAt = new Date();
        await payment.save({ session });

        await this.ledger.postSubscription(net, gst, {
          paymentId: payment._id,
          planCode: payment.planCode ?? 'UNKNOWN',
          session,
        });
      });
    } finally {
      await session.endSession();
    }

    // Outside the transaction: the subscription collection is not part of the
    // payments module, and a grant is safely repeatable.
    await this.entitlements.grant(
      payment.customerId.toString(),
      payment.planCode as PlanCode,
      undefined,
      payment._id,
    );

    this.events.emit('subscription.activated', {
      paymentId: payment.id as string,
      userId: payment.customerId.toString(),
      plan: payment.planCode,
      amount: payment.amount,
    });
  }

  private async onFailed(verified: VerifiedWebhook): Promise<void> {
    const payment = await this.payments.findOne({
      gatewayOrderId: verified.orderId,
    });
    if (!payment) return;
    // A failure notice arriving after a capture is noise; the money is here.
    if (payment.status === PaymentStatus.CAPTURED) return;

    payment.status = PaymentStatus.FAILED;
    payment.failureReason = verified.failureReason ?? ErrorCode.PAY_DECLINED;
    await payment.save();

    this.events.emit('payment.failed', {
      paymentId: payment.id as string,
      bookingId: payment.bookingId?.toString(),
      reason: payment.failureReason,
    });
  }

  /**
   * A refund the gateway has now actually settled. This is what posts the
   * reversal to the ledger - a refund we requested but that has not settled is
   * not money that has moved.
   */
  private async onRefundProcessed(verified: VerifiedWebhook): Promise<void> {
    if (!verified.refundId) return;

    const payment = await this.payments.findOne({
      'refunds.refundId': verified.refundId,
    });
    if (!payment) {
      this.logger.warn(`Refund ${verified.refundId} matches no payment - ignoring`);
      return;
    }

    const refund = payment.refunds.find((r) => r.refundId === verified.refundId);
    if (!refund || refund.status === 'processed') return;

    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        refund.status = 'processed';
        this.applyRefundTotals(payment, refund.amount as Paisa);
        await payment.save({ session });
        await this.postRefundLedger(payment, refund.refundId, refund.amount as Paisa, session);
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Completes a checkout against the fake gateway, as if the customer had paid.
   *
   * The fake gateway has no hosted checkout page for the browser to send anyone
   * to, so without this the flow could only ever be finished from a test. It
   * signs a real webhook and puts it through the real handler - the same
   * verification, deduplication and ledger path production uses. It refuses to
   * run against a real gateway, which is what stops it becoming a way to mark
   * genuine money as received.
   */
  async simulateCapture(paymentId: string, customerId: string): Promise<WebhookAck> {
    if (!(this.gateway instanceof FakeGateway)) {
      throw new ForbiddenException({
        code: ErrorCode.AUTH_FORBIDDEN,
        message: 'Simulated captures are only possible against the fake gateway.',
      });
    }

    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException();
    const payment = await this.payments.findOne({
      _id: new Types.ObjectId(paymentId),
      customerId: new Types.ObjectId(customerId),
    });
    if (!payment) throw new NotFoundException();

    const event = this.gateway.capturedEvent(
      payment.gatewayOrderId,
      payment.amount as Paisa,
    );
    const { rawBody, signature } = this.gateway.signPayload(event);
    return this.handleWebhook(rawBody, signature);
  }

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  /**
   * Sends a refund to the gateway and records it.
   *
   * The ledger is posted only once the gateway says the refund is processed. A
   * pending refund is recorded against the payment and settled later by the
   * refund.processed webhook, so the books never claim money left the platform
   * before it did.
   */
  async refund(
    paymentId: string,
    amount?: Paisa,
    reason?: string,
  ): Promise<RefundDto> {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException();
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundException();

    if (payment.purpose !== 'BOOKING') {
      throw new ConflictException({
        code: ErrorCode.PAY_NOT_REFUNDABLE,
        message:
          'Subscription refunds are handled by support, not through this route.',
      });
    }

    if (
      payment.status !== PaymentStatus.CAPTURED &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new ConflictException({
        code: ErrorCode.PAY_NOT_REFUNDABLE,
        message: 'Only a captured payment can be refunded.',
      });
    }
    if (!payment.gatewayPaymentId) {
      throw new ConflictException({
        code: ErrorCode.PAY_NOT_REFUNDABLE,
        message: 'This payment has no gateway reference to refund against.',
      });
    }

    const remaining = (payment.amount - payment.refundedAmount) as Paisa;
    const requested = (amount ?? remaining) as Paisa;

    if (requested <= 0 || requested > remaining) {
      throw new BadRequestException({
        code: ErrorCode.PAY_NOT_REFUNDABLE,
        message: `At most ${remaining} paisa can still be refunded on this payment.`,
      });
    }

    const result = await this.gateway.refund({
      gatewayPaymentId: payment.gatewayPaymentId,
      amount: requested,
      notes: { paymentId, reason: reason ?? 'Booking cancelled' },
    });

    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        payment.refunds.push({
          refundId: result.refundId,
          amount: result.amount,
          status: result.status,
          createdAt: new Date(),
          reason,
        });

        if (result.status === 'processed') {
          this.applyRefundTotals(payment, result.amount);
        }
        await payment.save({ session });

        if (result.status === 'processed') {
          await this.postRefundLedger(payment, result.refundId, result.amount, session);
        }
      });
    } finally {
      await session.endSession();
    }

    this.events.emit('payment.refunded', {
      paymentId,
      bookingId: payment.bookingId?.toString(),
      amount: result.amount,
      status: result.status,
    });

    return {
      paymentId,
      refundId: result.refundId,
      amount: result.amount,
      status: result.status,
    };
  }

  /**
   * Refunds a cancelled booking to the amount the refund policy allows.
   *
   * Driven by the domain event rather than called from BookingsService, so the
   * events module stays unaware that payments exist. Captured payments are
   * refunded oldest first until the allowed total is met, which is what a
   * customer expects to see on their statement.
   */
  @OnEvent('booking.cancelled')
  async refundForCancellation(payload: {
    bookingId: string;
    refundAmount: number;
  }): Promise<void> {
    let outstanding = payload.refundAmount;
    if (outstanding <= 0) return;

    const captured = await this.payments
      .find({
        bookingId: new Types.ObjectId(payload.bookingId),
        status: { $in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] },
      })
      .sort({ createdAt: 1 });

    for (const payment of captured) {
      if (outstanding <= 0) break;
      const refundable = payment.amount - payment.refundedAmount;
      if (refundable <= 0) continue;

      const take = Math.min(refundable, outstanding) as Paisa;
      try {
        await this.refund(payment.id as string, take, 'Booking cancelled');
        outstanding -= take;
      } catch (e) {
        // One failed refund must not strand the rest. Support picks these up
        // from the log and the payment's unchanged refundedAmount.
        this.logger.error(
          `Cancellation refund failed for payment ${payment.id as string}`,
          e as Error,
        );
      }
    }

    if (outstanding > 0) {
      this.logger.error(
        `Booking ${payload.bookingId} still owes ${outstanding} paisa in refunds`,
      );
    }
  }

  /** Mutates the payment's refund totals in memory; the caller saves. */
  private applyRefundTotals(payment: PaymentDocument, amount: Paisa): void {
    payment.refundedAmount += amount;
    payment.status =
      payment.refundedAmount >= payment.amount
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
  }

  private async postRefundLedger(
    payment: PaymentDocument,
    refundId: string,
    amount: Paisa,
    session: ClientSession,
  ): Promise<void> {
    const booking = asBookingPayment(payment);
    await this.ledger.postRefund(
      refundId,
      this.commission.reverse(amount, booking.commissionBps),
      {
        paymentId: booking._id,
        bookingId: booking.bookingId,
        vendorId: booking.vendorId,
        session,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Reads and housekeeping
  // ---------------------------------------------------------------------------

  async findOwned(paymentId: string, customerId: string): Promise<PaymentDto> {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException();
    // Ownership is part of the query, not a check after the fact.
    const payment = await this.payments.findOne({
      _id: paymentId,
      customerId: new Types.ObjectId(customerId),
    });
    if (!payment) throw new NotFoundException();
    return this.toDto(payment);
  }

  async listForBooking(bookingId: string, customerId: string): Promise<PaymentDto[]> {
    // Proves the caller owns the booking before any payment is read.
    await this.bookings.findOwned(bookingId, customerId);
    const rows = await this.payments
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: 1 });
    return rows.map((p) => this.toDto(p));
  }

  /**
   * The full picture of what is owed and when, including milestones that have
   * no payment row yet. The client renders this rather than deriving due dates
   * of its own.
   */
  async schedule(
    bookingId: string,
    customerId: string,
  ): Promise<PaymentScheduleEntry[]> {
    const booking = await this.bookings.findOwned(bookingId, customerId);
    const rows = await this.payments
      .find({ bookingId: booking._id })
      .sort({ createdAt: 1 });

    const latestFor = (m: PaymentMilestone): PaymentDocument | undefined =>
      rows.filter((r) => r.milestone === m).at(-1);

    const balanceDue = new Date(booking.eventDate);
    balanceDue.setUTCDate(balanceDue.getUTCDate() - BALANCE_DUE_DAYS_BEFORE);

    const entry = (
      milestone: PaymentMilestone,
      amount: number,
      dueDate: Date,
    ): PaymentScheduleEntry => {
      const row = latestFor(milestone);
      return {
        milestone,
        amount: amount as Paisa,
        dueDate: dueDate.toISOString(),
        status: row?.status ?? 'NOT_DUE',
        paymentId: (row?.id as string | undefined) ?? null,
      };
    };

    return [
      entry(
        PaymentMilestone.ADVANCE,
        booking.advanceAmount,
        booking.advanceDueAt ?? new Date(),
      ),
      entry(
        PaymentMilestone.BALANCE,
        booking.totalAmount - booking.advanceAmount,
        balanceDue,
      ),
    ];
  }

  /**
   * Closes intents the customer never completed. Without this an abandoned
   * checkout blocks a fresh one for its whole TTL, and CREATED rows accumulate
   * forever.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStaleIntents(now = new Date()): Promise<number> {
    const result = await this.payments.updateMany(
      {
        status: { $in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
        expiresAt: { $lt: now },
      },
      {
        $set: {
          status: PaymentStatus.FAILED,
          failureReason: ErrorCode.PAY_INTENT_EXPIRED,
        },
      },
    );

    if (result.modifiedCount) {
      this.logger.log(`Expired ${result.modifiedCount} stale payment intents`);
    }
    return result.modifiedCount;
  }

  /** A booking checkout. Subscription checkouts have their own shape. */
  private toIntent(payment: PaymentDocument): PaymentIntentDto {
    const booking = asBookingPayment(payment);
    return {
      paymentId: payment.id as string,
      gatewayOrderId: payment.gatewayOrderId,
      gatewayKeyId: this.gateway.publishableKey(),
      amount: payment.amount as Paisa,
      currency: 'INR',
      milestone: booking.milestone,
      bookingId: booking.bookingId.toString(),
      expiresAt: booking.expiresAt.toISOString(),
    };
  }

  private toDto(payment: PaymentDocument): PaymentDto {
    return {
      id: payment.id as string,
      purpose: payment.purpose,
      bookingId: payment.bookingId?.toString() ?? null,
      milestone: payment.milestone ?? null,
      planCode: payment.planCode ?? null,
      amount: payment.amount as Paisa,
      status: payment.status,
      method: payment.method ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
      failureReason: payment.failureReason ?? null,
    };
  }
}
