import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from '../media/media.module.js';

import { VendorsController } from './vendors.controller.js';
import { VendorsService } from './services/vendors.service.js';
import { ReviewsService } from './services/reviews.service.js';
import { Review, ReviewSchema } from './schemas/review.schema.js';
import { Booking, BookingSchema } from '../events/schemas/booking.schema.js';
import { User, UserSchema } from '../auth/schemas/user.schema.js';
import { Vendor, VendorSchema } from './schemas/vendor.schema.js';
import {
  VendorService as VendorServiceEntity,
  VendorServiceSchema,
} from './schemas/vendor-service.schema.js';
import {
  VendorAvailability,
  VendorAvailabilitySchema,
} from '../events/schemas/vendor-availability.schema.js';

/**
 * The supply side.
 *
 * It registers the availability model rather than importing EventsModule,
 * because EventsModule imports this one - enquiries need to know whether a
 * vendor is bookable. Registering the same schema in two modules is how
 * Mongoose is meant to be used; the collection is shared, the cycle is not.
 */
@Module({
  imports: [
    // Portfolio photos go through the shared file storage boundary.
    MediaModule,
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: VendorServiceEntity.name, schema: VendorServiceSchema },
      { name: VendorAvailability.name, schema: VendorAvailabilitySchema },
      { name: Review.name, schema: ReviewSchema },
      // Both read-only, for reviews: a review is written against a booking and
      // signed with the reviewer's name. Importing EventsModule to reach the
      // first would make the two modules mutually dependent, and AuthModule is
      // global infrastructure that has no business knowing about reviews.
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [VendorsController],
  providers: [VendorsService, ReviewsService],
  exports: [VendorsService, ReviewsService],
})
export class VendorsModule {}
