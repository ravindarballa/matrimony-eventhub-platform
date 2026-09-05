import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { VendorsController } from './vendors.controller.js';
import { VendorsService } from './services/vendors.service.js';
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
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: VendorServiceEntity.name, schema: VendorServiceSchema },
      { name: VendorAvailability.name, schema: VendorAvailabilitySchema },
    ]),
  ],
  controllers: [VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
