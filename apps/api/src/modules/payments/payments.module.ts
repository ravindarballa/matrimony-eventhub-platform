import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { EventsModule } from '../events/events.module.js';
import { PaymentsController } from './payments.controller.js';
import { FakeGateway } from './gateways/fake.gateway.js';
import { RazorpayGateway } from './gateways/razorpay.gateway.js';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './gateways/payment-gateway.interface.js';
import { CommissionService } from './services/commission.service.js';
import { LedgerService } from './services/ledger.service.js';
import { PaymentsService } from './services/payments.service.js';
import { Payment, PaymentSchema } from './schemas/payment.schema.js';
import { LedgerEntry, LedgerEntrySchema } from './schemas/ledger-entry.schema.js';
import { WebhookEvent, WebhookEventSchema } from './schemas/webhook-event.schema.js';

/**
 * Which gateway the platform talks to is configuration, not code.
 *
 * PAYMENT_GATEWAY=fake is the default so the whole flow runs locally with no
 * credentials; razorpay is selected explicitly. Selecting razorpay without
 * credentials throws at boot rather than at the first checkout - a payment path
 * that fails only when a real customer reaches it is the worst possible time to
 * find out.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: WebhookEvent.name, schema: WebhookEventSchema },
    ]),
    // For BookingsService: amounts are read from the booking, never the client.
    EventsModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    CommissionService,
    LedgerService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentGateway => {
        const logger = new Logger('PaymentGateway');
        const choice = config.get<string>('payments.gateway', 'fake');

        if (choice === 'razorpay') {
          const keyId = config.getOrThrow<string>('payments.razorpay.keyId');
          const keySecret = config.getOrThrow<string>('payments.razorpay.keySecret');
          const webhookSecret = config.getOrThrow<string>(
            'payments.razorpay.webhookSecret',
          );

          if (!keyId || !keySecret || !webhookSecret) {
            throw new Error(
              'PAYMENT_GATEWAY=razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET',
            );
          }

          logger.log(`Using Razorpay (${keyId.startsWith('rzp_live') ? 'LIVE' : 'test'})`);
          return new RazorpayGateway(keyId, keySecret, webhookSecret);
        }

        const secret = config.get<string>(
          'payments.fakeWebhookSecret',
          'fake_webhook_secret_local_dev',
        );
        if (config.get<string>('nodeEnv') === 'production') {
          throw new Error('The fake payment gateway must not be used in production');
        }
        logger.warn('Using the FAKE payment gateway - no money will move');
        return new FakeGateway(secret);
      },
    },
  ],
  exports: [PaymentsService, LedgerService, CommissionService],
})
export class PaymentsModule {}
