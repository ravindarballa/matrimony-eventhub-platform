import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BookingsController } from './events.controller.js';
import { EnquiriesController } from './enquiries.controller.js';
import { BookingsService } from './services/bookings.service.js';
import { EnquiriesService } from './services/enquiries.service.js';
import { BookingStateMachine } from './services/booking-state-machine.js';
import { RefundCalculator } from './services/refund-calculator.js';
import { Booking, BookingSchema } from './schemas/booking.schema.js';
import { Enquiry, EnquirySchema } from './schemas/enquiry.schema.js';
import { Quote, QuoteSchema } from './schemas/quote.schema.js';
import { Wedding, WeddingSchema } from './schemas/wedding.schema.js';
import {
  WeddingFunction,
  WeddingFunctionSchema,
} from './schemas/wedding-function.schema.js';
import {
  VendorAvailability,
  VendorAvailabilitySchema,
} from './schemas/vendor-availability.schema.js';
import { VendorsModule } from '../vendors/vendors.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Enquiry.name, schema: EnquirySchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: Wedding.name, schema: WeddingSchema },
      { name: WeddingFunction.name, schema: WeddingFunctionSchema },
      { name: VendorAvailability.name, schema: VendorAvailabilitySchema },
    ]),
    // Enquiries must know whether a vendor is bookable before fanning out.
    VendorsModule,
  ],
  controllers: [BookingsController, EnquiriesController],
  providers: [
    BookingsService,
    EnquiriesService,
    BookingStateMachine,
    RefundCalculator,
  ],
  // Other modules consume the services; nobody touches the schemas directly.
  exports: [BookingsService, EnquiriesService, BookingStateMachine],
})
export class EventsModule {}
