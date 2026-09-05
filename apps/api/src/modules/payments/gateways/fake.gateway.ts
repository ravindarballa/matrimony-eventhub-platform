import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErrorCode, type Paisa } from '@eventhub/contracts';

import type {
  GatewayOrder,
  GatewayRefund,
  PaymentGateway,
  VerifiedWebhook,
} from './payment-gateway.interface.js';

/**
 * A local stand-in for a real payment provider.
 *
 * It implements the same HMAC-SHA256 webhook signing scheme as Razorpay, so the
 * verification path exercised in development and tests is the real one - a
 * forged signature is rejected here exactly as it would be in production. What
 * it does not do is move money or make network calls.
 *
 * This is what lets the whole payment flow be built and tested before anyone
 * has gateway credentials. Set PAYMENT_GATEWAY=razorpay to switch.
 */
@Injectable()
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';
  private readonly logger = new Logger(FakeGateway.name);

  constructor(private readonly webhookSecret: string) {}

  publishableKey(): string {
    return 'fake_key_local_dev';
  }

  async createOrder(params: {
    amount: Paisa;
    receipt: string;
  }): Promise<GatewayOrder> {
    const orderId = `order_fake_${randomBytes(8).toString('hex')}`;
    this.logger.debug(
      `Created fake order ${orderId} for ${params.amount} paisa (${params.receipt})`,
    );
    return { orderId, amount: params.amount, currency: 'INR' };
  }

  async refund(params: {
    gatewayPaymentId: string;
    amount: Paisa;
  }): Promise<GatewayRefund> {
    const refundId = `rfnd_fake_${randomBytes(8).toString('hex')}`;
    this.logger.debug(`Fake refund ${refundId} of ${params.amount} paisa`);
    return { refundId, amount: params.amount, status: 'processed' };
  }

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook {
    // Verify BEFORE parsing. Parsing attacker-controlled JSON that has not been
    // authenticated is how you get surprised.
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const given = Buffer.from(signature ?? '', 'utf8');
    const want = Buffer.from(expected, 'utf8');

    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new UnauthorizedException(ErrorCode.PAY_BAD_SIGNATURE);
    }

    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      id?: string;
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            amount?: number;
            method?: string;
            error_description?: string;
          };
        };
        refund?: { entity?: { id?: string; amount?: number } };
      };
    };

    const payment = parsed.payload?.payment?.entity;
    const refund = parsed.payload?.refund?.entity;

    return {
      eventId: parsed.id ?? '',
      event: parsed.event ?? '',
      orderId: payment?.order_id,
      paymentId: payment?.id,
      refundId: refund?.id,
      amount: (payment?.amount ?? refund?.amount) as Paisa | undefined,
      method: payment?.method,
      failureReason: payment?.error_description,
    };
  }

  /**
   * Test helper: produces a correctly signed webhook body, so tests can drive
   * the real verification path rather than stubbing it out.
   */
  signPayload(body: unknown): { rawBody: Buffer; signature: string } {
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    const signature = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return { rawBody, signature };
  }

  /** Test helper: builds a payment.captured event for an order. */
  capturedEvent(orderId: string, amount: Paisa, method = 'upi') {
    return {
      id: `evt_fake_${randomBytes(8).toString('hex')}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_fake_${randomBytes(8).toString('hex')}`,
            order_id: orderId,
            amount,
            method,
            status: 'captured',
          },
        },
      },
    };
  }

  /** Test helper: builds a payment.failed event for an order. */
  failedEvent(orderId: string, amount: Paisa, reason = 'Insufficient funds') {
    return {
      id: `evt_fake_${randomBytes(8).toString('hex')}`,
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_fake_${randomBytes(8).toString('hex')}`,
            order_id: orderId,
            amount,
            method: 'card',
            error_description: reason,
          },
        },
      },
    };
  }
}
