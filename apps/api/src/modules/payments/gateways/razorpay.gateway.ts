import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErrorCode, type Paisa } from '@eventhub/contracts';

import type {
  GatewayOrder,
  GatewayRefund,
  PaymentGateway,
  VerifiedWebhook,
} from './payment-gateway.interface.js';

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayRefundResponse {
  id: string;
  amount: number;
  status: string;
}

/**
 * Razorpay implementation.
 *
 * Uses the REST API over fetch rather than the SDK - the surface needed here is
 * three calls, and avoiding the dependency keeps the ESM build simple.
 *
 * Test-mode credentials (rzp_test_...) are free and need no business KYC; only
 * live mode requires activation. Nothing here differs between the two.
 */
@Injectable()
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';
  private readonly logger = new Logger(RazorpayGateway.name);
  private readonly base = 'https://api.razorpay.com/v1';

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  publishableKey(): string {
    return this.keyId;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    return `Basic ${token}`;
  }

  async createOrder(params: {
    amount: Paisa;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder> {
    const res = await fetch(`${this.base}/orders`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Razorpay takes paisa, which is what we store - no conversion.
        amount: params.amount,
        currency: 'INR',
        receipt: params.receipt,
        notes: params.notes ?? {},
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`Razorpay order creation failed: ${res.status} ${detail}`);
      throw new ServiceUnavailableException({
        code: ErrorCode.PAY_GATEWAY_ERROR,
        message: 'The payment provider is not responding. Please try again.',
      });
    }

    const order = (await res.json()) as RazorpayOrderResponse;
    return { orderId: order.id, amount: order.amount as Paisa, currency: 'INR' };
  }

  async refund(params: {
    gatewayPaymentId: string;
    amount: Paisa;
    notes?: Record<string, string>;
  }): Promise<GatewayRefund> {
    const res = await fetch(
      `${this.base}/payments/${params.gatewayPaymentId}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: params.amount, notes: params.notes ?? {} }),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`Razorpay refund failed: ${res.status} ${detail}`);
      throw new ServiceUnavailableException({
        code: ErrorCode.PAY_GATEWAY_ERROR,
        message: 'The payment provider is not responding. Please try again.',
      });
    }

    const refund = (await res.json()) as RazorpayRefundResponse;
    return {
      refundId: refund.id,
      amount: refund.amount as Paisa,
      status: refund.status === 'processed' ? 'processed' : 'pending',
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook {
    // Must be the RAW body. A parsed-and-restringified body will not match,
    // because key order and whitespace differ from what was signed.
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
}
