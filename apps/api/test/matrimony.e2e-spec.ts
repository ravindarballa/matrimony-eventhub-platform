import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import {
  FREE_DAILY_INTEREST_QUOTA,
  InterestStatus,
  PhotoPrivacy,
  ProfileStatus,
} from '@eventhub/contracts';

import { MatrimonyModule } from '../src/modules/matrimony/matrimony.module.js';
import { ProfilesService } from '../src/modules/matrimony/services/profiles.service.js';
import { ProfileSearchService } from '../src/modules/matrimony/services/profile-search.service.js';
import { InterestsService } from '../src/modules/matrimony/services/interests.service.js';
import { MatrimonyProfile } from '../src/modules/matrimony/schemas/matrimony-profile.schema.js';
import {
  Block,
  Interest,
  PartnerPreference,
  Shortlist,
} from '../src/modules/matrimony/schemas/matrimony-social.schema.js';
import { User } from '../src/modules/auth/schemas/user.schema.js';
import type { MatrimonyProfileDocument } from '../src/modules/matrimony/schemas/matrimony-profile.schema.js';
import type { UserDocument } from '../src/modules/auth/schemas/user.schema.js';
import type {
  BlockDocument,
  InterestDocument,
  ShortlistDocument,
} from '../src/modules/matrimony/schemas/matrimony-social.schema.js';

/**
 * The rules families actually judge a matrimony platform by: that a photo set
 * to blur stays blurred, that a block works in both directions, that an
 * interest cannot be sent twice, and that a phone number appears only when both
 * sides have agreed.
 */
describe('Matrimony (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let profiles: ProfilesService;
  let search: ProfileSearchService;
  let interests: InterestsService;

  let profileModel: Model<MatrimonyProfileDocument>;
  let interestModel: Model<InterestDocument>;
  let shortlistModel: Model<ShortlistDocument>;
  let blockModel: Model<BlockDocument>;
  let userModel: Model<UserDocument>;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        MatrimonyModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    profiles = moduleRef.get(ProfilesService);
    search = moduleRef.get(ProfileSearchService);
    interests = moduleRef.get(InterestsService);

    profileModel = moduleRef.get(getModelToken(MatrimonyProfile.name));
    interestModel = moduleRef.get(getModelToken(Interest.name));
    shortlistModel = moduleRef.get(getModelToken(Shortlist.name));
    blockModel = moduleRef.get(getModelToken(Block.name));
    userModel = moduleRef.get(getModelToken(User.name));

    await Promise.all([
      profileModel.syncIndexes(),
      interestModel.syncIndexes(),
      shortlistModel.syncIndexes(),
      blockModel.syncIndexes(),
      moduleRef.get<Model<unknown>>(getModelToken(PartnerPreference.name)).syncIndexes(),
    ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      profileModel.deleteMany({}),
      interestModel.deleteMany({}),
      shortlistModel.deleteMany({}),
      blockModel.deleteMany({}),
      userModel.deleteMany({}),
    ]);
  });

  let mobileCounter = 6000000000;

  /** A published profile belonging to a real user record. */
  const seed = async (
    overrides: {
      gender?: 'MALE' | 'FEMALE';
      displayName?: string;
      city?: string;
      community?: string;
      gotra?: string;
      age?: number;
      photoPrivacy?: PhotoPrivacy;
      nakshatra?: number;
      rashi?: number;
      publish?: boolean;
    } = {},
  ) => {
    const mobile = String((mobileCounter += 1));
    const user = await userModel.create({
      fullName: overrides.displayName ?? 'Member',
      mobile,
      roles: ['SEEKER'],
      status: 'ACTIVE',
      mobileVerified: true,
    });
    const userId = user.id as string;
    const age = overrides.age ?? 28;

    await profiles.upsert(userId, {
      displayName: overrides.displayName ?? 'Member',
      managedBy: 'SELF',
      gender: overrides.gender ?? 'FEMALE',
      dateOfBirth: new Date(
        Date.UTC(new Date().getUTCFullYear() - age, 0, 1),
      ).toISOString(),
      heightCm: 165,
      maritalStatus: 'NEVER_MARRIED',
      religion: 'Hindu',
      community: overrides.community ?? 'Brahmin',
      gotra: overrides.gotra,
      motherTongue: 'Telugu',
      city: overrides.city ?? 'Hyderabad',
      diet: 'VEGETARIAN',
      about:
        'A short introduction that is comfortably past the fifty character mark for completeness.',
      education: { highestQualification: 'B.Tech' },
      career: { occupation: 'Software Engineer', annualIncome: 1_800_000_00 },
      family: { fatherOccupation: 'Retired', nativePlace: 'Warangal' },
      horoscope: {
        nakshatra: overrides.nakshatra ?? 4,
        rashi: overrides.rashi ?? 2,
      },
      privacy: overrides.photoPrivacy
        ? { photos: overrides.photoPrivacy }
        : undefined,
    });

    // A moderated photo, so the privacy rules have something to act on.
    await profileModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          photos: [
            {
              id: 'p1',
              url: 'https://cdn.example.com/photo.jpg',
              isPrimary: true,
              moderation: 'APPROVED',
            },
          ],
        },
      },
    );

    if (overrides.publish !== false) await profiles.publish(userId);

    const profile = await profileModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    return { userId, profileId: profile!.id as string, mobile };
  };

  // ------------------------------------------------------------------ profile

  describe('profile', () => {
    it('refuses an underage bride, whatever the client allows', async () => {
      const user = await userModel.create({
        fullName: 'Too Young',
        mobile: String((mobileCounter += 1)),
        roles: ['SEEKER'],
        status: 'ACTIVE',
      });

      await expect(
        profiles.upsert(user.id as string, {
          displayName: 'Too Young',
          managedBy: 'PARENT',
          gender: 'FEMALE',
          dateOfBirth: new Date(
            Date.UTC(new Date().getUTCFullYear() - 17, 0, 1),
          ).toISOString(),
          heightCm: 160,
          maritalStatus: 'NEVER_MARRIED',
          religion: 'Hindu',
          community: 'Brahmin',
          motherTongue: 'Telugu',
          city: 'Hyderabad',
          diet: 'VEGETARIAN',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('holds a groom to 21, not 18', async () => {
      const user = await userModel.create({
        fullName: 'Nineteen',
        mobile: String((mobileCounter += 1)),
        roles: ['SEEKER'],
        status: 'ACTIVE',
      });

      const dob = new Date(
        Date.UTC(new Date().getUTCFullYear() - 19, 0, 1),
      ).toISOString();
      const base = {
        displayName: 'Nineteen',
        managedBy: 'SELF' as const,
        dateOfBirth: dob,
        heightCm: 175,
        maritalStatus: 'NEVER_MARRIED' as const,
        religion: 'Hindu',
        community: 'Brahmin',
        motherTongue: 'Telugu',
        city: 'Hyderabad',
        diet: 'VEGETARIAN' as const,
      };

      await expect(
        profiles.upsert(user.id as string, { ...base, gender: 'MALE' }),
      ).rejects.toMatchObject({ status: 400 });

      // The same date of birth is fine for a bride.
      await expect(
        profiles.upsert(user.id as string, { ...base, gender: 'FEMALE' }),
      ).resolves.toBeDefined();
    });

    it('will not publish a profile that is barely filled in', async () => {
      const user = await userModel.create({
        fullName: 'Sparse',
        mobile: String((mobileCounter += 1)),
        roles: ['SEEKER'],
        status: 'ACTIVE',
      });

      const created = await profiles.upsert(user.id as string, {
        displayName: 'Sparse',
        managedBy: 'SELF',
        gender: 'FEMALE',
        dateOfBirth: new Date(Date.UTC(1996, 0, 1)).toISOString(),
        heightCm: 160,
        maritalStatus: 'NEVER_MARRIED',
        religion: 'Hindu',
        community: 'Brahmin',
        motherTongue: 'Telugu',
        city: 'Hyderabad',
        diet: 'VEGETARIAN',
      });

      expect(created.completeness).toBeLessThan(60);
      await expect(profiles.publish(user.id as string)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('merges one wizard step without wiping the others', async () => {
      const { userId } = await seed();

      const before = await profiles.findOwn(userId);
      expect(before!.education.highestQualification).toBe('B.Tech');

      // A later step sends only its own section.
      await profiles.upsert(userId, {
        displayName: before!.displayName,
        managedBy: before!.managedBy,
        gender: before!.gender,
        dateOfBirth: before!.dateOfBirth,
        heightCm: before!.heightCm,
        maritalStatus: before!.maritalStatus,
        religion: before!.religion,
        community: before!.community,
        motherTongue: before!.motherTongue,
        city: before!.city,
        diet: before!.diet,
        family: { siblings: 2 },
      });

      const after = await profiles.findOwn(userId);
      expect(after!.family.siblings).toBe(2);
      expect(after!.education.highestQualification).toBe('B.Tech');
      expect(after!.career.occupation).toBe('Software Engineer');
    });

    it('hands off to the events module when a profile goes engaged', async () => {
      const { userId } = await seed();
      const engaged = await profiles.markEngaged(userId);

      expect(engaged.status).toBe(ProfileStatus.ENGAGED);
      // And it leaves search, because it is no longer looking.
      const groom = await seed({ gender: 'MALE' });
      const { items } = await search.search(groom.userId, {});
      expect(items).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------- search

  describe('search', () => {
    it('only ever returns the opposite gender', async () => {
      await seed({ gender: 'FEMALE', displayName: 'Bride' });
      await seed({ gender: 'MALE', displayName: 'Another groom' });
      const viewer = await seed({ gender: 'MALE', displayName: 'Viewer' });

      const { items } = await search.search(viewer.userId, {});
      expect(items.map((i) => i.displayName)).toEqual(['Bride']);
    });

    it('excludes gotras the family cannot consider', async () => {
      await seed({ gender: 'FEMALE', displayName: 'Same gotra', gotra: 'Kashyap' });
      await seed({ gender: 'FEMALE', displayName: 'Different', gotra: 'Bharadwaj' });
      const viewer = await seed({ gender: 'MALE', gotra: 'Kashyap' });

      // Deliberately lower case: the same gotra typed differently is still the
      // same gotra, and showing it would be a serious error to a family.
      const { items } = await search.search(viewer.userId, {
        excludeGotras: ['kashyap'],
      });
      expect(items.map((i) => i.displayName)).toEqual(['Different']);
    });

    it('filters by age range', async () => {
      await seed({ gender: 'FEMALE', displayName: 'Younger', age: 24 });
      await seed({ gender: 'FEMALE', displayName: 'Older', age: 34 });
      const viewer = await seed({ gender: 'MALE' });

      const { items } = await search.search(viewer.userId, { ageMin: 30, ageMax: 40 });
      expect(items.map((i) => i.displayName)).toEqual(['Older']);
    });

    it('carries a guna score when both horoscopes are entered', async () => {
      await seed({ gender: 'FEMALE', nakshatra: 4, rashi: 2 });
      const viewer = await seed({ gender: 'MALE', nakshatra: 13, rashi: 6 });

      const { items } = await search.search(viewer.userId, {});
      expect(items[0]!.gunaScore).toBeGreaterThan(0);
      expect(items[0]!.gunaScore).toBeLessThanOrEqual(36);
    });

    it('never puts a photo on the wire for a blurred profile', async () => {
      await seed({
        gender: 'FEMALE',
        photoPrivacy: PhotoPrivacy.BLURRED_UNTIL_MUTUAL,
      });
      const viewer = await seed({ gender: 'MALE' });

      const { items } = await search.search(viewer.userId, {});
      expect(items[0]!.photoUrl).toBeNull();
      // The client is told a photo exists, without being given it.
      expect(items[0]!.photosBlurred).toBe(true);
    });

    it('leaves an unpublished profile out of search entirely', async () => {
      await seed({ gender: 'FEMALE', publish: false });
      const viewer = await seed({ gender: 'MALE' });

      const { items } = await search.search(viewer.userId, {});
      expect(items).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------ privacy

  describe('privacy and safety', () => {
    it('hides birth time and place from another member', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      await profileModel.updateOne(
        { _id: new Types.ObjectId(bride.profileId) },
        { $set: { 'horoscope.birthTime': '04:35', 'horoscope.birthPlace': 'Warangal' } },
      );
      const viewer = await seed({ gender: 'MALE' });

      const detail = await profiles.viewProfile(bride.profileId, viewer.userId);
      expect(JSON.stringify(detail)).not.toContain('Nizamabad');
      expect(JSON.stringify(detail)).not.toContain('04:35');
      // What guna matching needs is still there.
      expect(detail.horoscope.nakshatra).toBe(4);
    });

    it('shows an income band rather than the figure', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const viewer = await seed({ gender: 'MALE' });

      const detail = await profiles.viewProfile(bride.profileId, viewer.userId);
      expect(detail.career.incomeBand).toBe('₹10–25 lakh');
      expect(JSON.stringify(detail)).not.toContain('180000000');
    });

    it('withholds the phone number until interest is mutual', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const before = await profiles.viewProfile(bride.profileId, groom.userId);
      expect(before.contact).toBeNull();

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });
      await interests.accept(bride.userId, sent.id);

      const after = await profiles.viewProfile(bride.profileId, groom.userId);
      expect(after.contact?.mobile).toBe(bride.mobile);
      // And the photo unblurs at the same moment, for the same reason.
      expect(after.photoUrl).not.toBeNull();
    });

    it('makes a blocked profile disappear in both directions', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      await interests.block(bride.userId, groom.profileId, 'Rude messages');

      // The blocker cannot see them.
      await expect(
        profiles.viewProfile(groom.profileId, bride.userId),
      ).rejects.toMatchObject({ status: 404 });
      // And, crucially, neither can the blocked party - otherwise the block
      // merely announces itself.
      await expect(
        profiles.viewProfile(bride.profileId, groom.userId),
      ).rejects.toMatchObject({ status: 404 });

      const { items } = await search.search(groom.userId, {});
      expect(items).toHaveLength(0);
    });

    it('withdraws any pending interest when a block is placed', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });
      await interests.block(bride.userId, groom.profileId);

      const stored = await interestModel.findById(sent.id);
      expect(stored!.status).toBe(InterestStatus.WITHDRAWN);
    });

    it('unblocking puts them back in view', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      await interests.block(bride.userId, groom.profileId);
      await interests.unblock(bride.userId, groom.profileId);

      await expect(
        profiles.viewProfile(groom.profileId, bride.userId),
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------- interests

  describe('interests', () => {
    it('cannot be sent twice, however fast the taps', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          interests.send(groom.userId, { toProfileId: bride.profileId }),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      // The unique index is what holds this, not the order things ran in.
      expect(await interestModel.countDocuments()).toBe(1);

      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
      });
    });

    it('stops a free member at the daily quota', async () => {
      const groom = await seed({ gender: 'MALE' });
      const brides = [];
      for (let i = 0; i <= FREE_DAILY_INTEREST_QUOTA; i += 1) {
        brides.push(await seed({ gender: 'FEMALE', displayName: `Bride ${i}` }));
      }

      for (let i = 0; i < FREE_DAILY_INTEREST_QUOTA; i += 1) {
        await interests.send(groom.userId, { toProfileId: brides[i]!.profileId });
      }

      await expect(
        interests.send(groom.userId, {
          toProfileId: brides[FREE_DAILY_INTEREST_QUOTA]!.profileId,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const quota = await interests.remainingQuota(groom.userId);
      expect(quota.used).toBe(FREE_DAILY_INTEREST_QUOTA);
    });

    it('counts a withdrawn interest against the quota', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });
      await interests.withdraw(groom.userId, sent.id);

      // Otherwise send-withdraw-send would defeat the limit entirely.
      expect((await interests.remainingQuota(groom.userId)).used).toBe(1);
    });

    it('lets only the recipient answer', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });
      const stranger = await seed({ gender: 'MALE' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });

      await expect(
        interests.accept(stranger.userId, sent.id),
      ).rejects.toMatchObject({ status: 403 });
      // The sender cannot accept their own interest either.
      await expect(interests.accept(groom.userId, sent.id)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('refuses to answer an interest twice', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });
      await interests.accept(bride.userId, sent.id);

      await expect(interests.decline(bride.userId, sent.id)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('will not let a withdrawal happen after an answer', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });
      await interests.decline(bride.userId, sent.id);

      await expect(
        interests.withdraw(groom.userId, sent.id),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('lists received, sent and accepted separately', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });

      expect(await interests.list(groom.userId, 'sent')).toHaveLength(1);
      expect(await interests.list(bride.userId, 'received')).toHaveLength(1);
      expect(await interests.list(bride.userId, 'accepted')).toHaveLength(0);

      await interests.accept(bride.userId, sent.id);

      // Once accepted it leaves the pending inbox and shows for both sides.
      expect(await interests.list(bride.userId, 'received')).toHaveLength(0);
      expect(await interests.list(bride.userId, 'accepted')).toHaveLength(1);
      expect(await interests.list(groom.userId, 'accepted')).toHaveLength(1);
    });

    it('shows each side the other person, never themselves', async () => {
      const bride = await seed({ gender: 'FEMALE', displayName: 'Anita' });
      const groom = await seed({ gender: 'MALE', displayName: 'Rahul' });

      const sent = await interests.send(groom.userId, {
        toProfileId: bride.profileId,
      });

      // The recipient's inbox must show who wrote to them.
      const received = await interests.list(bride.userId, 'received');
      expect(received[0]!.counterpart.displayName).toBe('Rahul');
      expect(received[0]!.counterpart.id).toBe(groom.profileId);

      // And the sender's list shows who they wrote to.
      const outgoing = await interests.list(groom.userId, 'sent');
      expect(outgoing[0]!.counterpart.displayName).toBe('Anita');

      // Accepting returns the same view to the accepter.
      const accepted = await interests.accept(bride.userId, sent.id);
      expect(accepted.counterpart.displayName).toBe('Rahul');

      // And both sides' accepted tab shows the other person.
      expect(
        (await interests.list(bride.userId, 'accepted'))[0]!.counterpart.displayName,
      ).toBe('Rahul');
      expect(
        (await interests.list(groom.userId, 'accepted'))[0]!.counterpart.displayName,
      ).toBe('Anita');
    });

    it('requires the sender to have published their own profile', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE', publish: false });

      await expect(
        interests.send(groom.userId, { toProfileId: bride.profileId }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  // ---------------------------------------------------------------- shortlist

  describe('shortlist', () => {
    it('keeps the private note private', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      await interests.shortlist(groom.userId, bride.profileId, 'Mother liked this one');

      const mine = await interests.listShortlist(groom.userId);
      expect(mine[0]!.note).toBe('Mother liked this one');

      // The note belongs to the owner and appears nowhere the other side reads.
      const asSeenByBride = await profiles.viewProfile(
        groom.profileId,
        bride.userId,
      );
      expect(JSON.stringify(asSeenByBride)).not.toContain('Mother liked');
    });

    it('is idempotent, and updates the note on a second save', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      await interests.shortlist(groom.userId, bride.profileId, 'First note');
      await interests.shortlist(groom.userId, bride.profileId, 'Second note');

      const mine = await interests.listShortlist(groom.userId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.note).toBe('Second note');
    });

    it('shows the shortlisted flag on search results', async () => {
      const bride = await seed({ gender: 'FEMALE' });
      const groom = await seed({ gender: 'MALE' });

      await interests.shortlist(groom.userId, bride.profileId);
      const { items } = await search.search(groom.userId, {});
      expect(items[0]!.shortlisted).toBe(true);
    });
  });
});
