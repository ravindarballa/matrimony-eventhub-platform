import type { Paisa } from '@eventhub/contracts';

/**
 * The gateway boundary.
 *
 * Everything the platform needs from a payment provider is expressed here, so
 * the payment service never imports a vendor SDK. Two implementations exist:
 * FakeGateway for local development and tests (no credentials, no network) and
 * RazorpayGateway for real use. Swapping between them is configuration.
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface GatewayOrder {
  orderId: string;
  amount: Paisa;
  currency: 'INR';
}

export interface GatewayRefund {
  refundId: string;
  amount: Paisa;
  status: 'processed' | 'pending' | 'failed';
}

/** The normalised shape of an inbound webhook, after signature verification. */
export interface VerifiedWebhook {
  /** Provider's event id - used to deduplicate retried deliveries. */
  eventId: string;
  event: string;
  orderId?: string;
  paymentId?: string;
  refundId?: string;
  amount?: Paisa;
  method?: string;
  failureReason?: string;
}

export interface PaymentGateway {
  readonly name: string;

  /** The publishable key the browser checkout needs. Never the secret. */
  publishableKey(): string;

  createOrder(params: {
    amount: Paisa;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder>;

  refund(params: {
    gatewayPaymentId: string;
    amount: Paisa;
    notes?: Record<string, string>;
  }): Promise<GatewayRefund>;

  /**
   * Verifies the signature against the RAW request body and returns the parsed
   * event, or throws. Implementations must compare in constant time and must
   * not parse before verifying.
   */
  verifyWebhook(rawBody: Buffer, signature: string): VerifiedWebhook;
}
