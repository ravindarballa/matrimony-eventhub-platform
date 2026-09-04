import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BookingsController } from './events.controller.js';
import { BookingsService } from './services/bookings.service.js';
import { BookingStateMachine } from './services/booking-state-machine.js';
import { RefundCalculator } from './services/refund-calculator.js';
import { Booking, BookingSchema } from './schemas/booking.schema.js';
import { Quote, QuoteSchema } from './schemas/quote.schema.js';
import {
  VendorAvailability,
  VendorAvailabilitySchema,
} from './schemas/vendor-availability.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: VendorAvailability.name, schema: VendorAvailabilitySchema },
    ]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingStateMachine, RefundCalculator],
  // Other modules consume the service; nobody touches the schemas directly.
  exports: [BookingsService, BookingStateMachine],
})
export class EventsModule {}
