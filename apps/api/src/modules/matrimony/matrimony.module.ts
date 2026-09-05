import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MatrimonyController } from './matrimony.controller.js';
import { ProfilesService } from './services/profiles.service.js';
import { ProfileSearchService } from './services/profile-search.service.js';
import { InterestsService } from './services/interests.service.js';
import { RelationsService } from './services/relations.service.js';
import { GunaService } from './services/guna.service.js';
import {
  MatrimonyProfile,
  MatrimonyProfileSchema,
} from './schemas/matrimony-profile.schema.js';
import {
  Block,
  BlockSchema,
  Interest,
  InterestSchema,
  PartnerPreference,
  PartnerPreferenceSchema,
  Shortlist,
  ShortlistSchema,
} from './schemas/matrimony-social.schema.js';
import { User, UserSchema } from '../auth/schemas/user.schema.js';

/**
 * The matrimony bounded context.
 *
 * It registers the User schema rather than importing AuthModule: the only thing
 * it needs from a user is the mobile number to reveal once interest is mutual,
 * and reaching into the auth service for that would couple two contexts over
 * one field.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MatrimonyProfile.name, schema: MatrimonyProfileSchema },
      { name: PartnerPreference.name, schema: PartnerPreferenceSchema },
      { name: Interest.name, schema: InterestSchema },
      { name: Shortlist.name, schema: ShortlistSchema },
      { name: Block.name, schema: BlockSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [MatrimonyController],
  providers: [
    ProfilesService,
    ProfileSearchService,
    InterestsService,
    RelationsService,
    GunaService,
  ],
  exports: [ProfilesService, GunaService],
})
export class MatrimonyModule {}
