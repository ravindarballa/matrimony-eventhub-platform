import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { BookingStatus, VendorCategory } from '@eventhub/contracts';

import { VendorsModule } from '../src/modules/vendors/vendors.module.js';
import { VendorsService } from '../src/modules/vendors/services/vendors.service.js';
import { ReviewsService } from '../src/modules/vendors/services/reviews.service.js';
import { Vendor } from '../src/modules/vendors/schemas/vendor.schema.js';
import { Review } from '../src/modules/vendors/schemas/review.schema.js';
import { Booking } from '../src/modules/events/schemas/booking.schema.js';
import { User } from '../src/modules/auth/schemas/user.schema.js';
import type { VendorDocument } from '../src/modules/vendors/schemas/vendor.schema.js';
import type { ReviewDocument } from '../src/modules/vendors/schemas/review.schema.js';
import type { BookingDocument } from '../src/modules/events/schemas/booking.schema.js';
import type { UserDocument } from '../src/modules/auth/schemas/user.schema.js';

/**
 * Reviews, and the rating they produce.
 *
 * Before this existed, `rating` and `reviewCount` were numbers on the vendor
 * document that were seeded once and never written again, while the search
 * sorted by them and a filter offered to hide anything under four stars. The
 * tests that matter here are therefore the ones proving the rating is derived:
 * that it moves when a review lands, and that a review cannot land without a
 * completed booking behind it.
 */
describe('Reviews (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let reviews: ReviewsService;
  let vendors: VendorsService;
  let vendorModel: Model<VendorDocument>;
  let reviewModel: Model<ReviewDocument>;
  let bookingModel: Model<BookingDocument>;
  let userModel: Model<UserDocument>;

  const scores = (n: number) => ({
    quality: n,
    professionalism: n,
    value: n,
    flexibility: n,
  });

  const body = 'They ran the sangeet without a single thing going wrong, and stayed late.';

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [() => ({ nodeEnv: 'test' })] }),
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        VendorsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    reviews = moduleRef.get(ReviewsService);
    vendors = moduleRef.get(VendorsService);
    vendorModel = moduleRef.get(getModelToken(Vendor.name));
    reviewModel = moduleRef.get(getModelToken(Review.name));
    bookingModel = moduleRef.get(getModelToken(Booking.name));
    userModel = moduleRef.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      vendorModel.deleteMany({}),
      reviewModel.deleteMany({}),
      bookingModel.deleteMany({}),
      userModel.deleteMany({}),
    ]);
  });

  /** A vendor with the rating it is seeded with: none. */
  const aVendor = async (): Promise<{ id: string; ownerId: string }> => {
    const ownerId = new Types.ObjectId().toString();
    const vendor = await vendors.onboard(ownerId, {
      businessName: 'Sunrise Banquets',
      category: VendorCategory.VENUE,
      city: 'Hyderabad',
      description: 'A banquet hall on the lake, seating four hundred at a sitting.',
    });
    return { id: vendor.id, ownerId };
  };

  let mobileSeq = 9_000_000_00;
  const aCustomer = async (fullName: string): Promise<string> => {
    const user = await userModel.create({
      fullName,
      mobile: String(mobileSeq++),
      roles: ['CUSTOMER'],
      status: 'ACTIVE',
    });
    return user.id as string;
  };

  const aBooking = async (
    customerId: string,
    vendorId: string,
    status: BookingStatus = BookingStatus.COMPLETED,
    paidAmount = 350_000_00,
  ): Promise<string> => {
    const booking = await bookingModel.create({
      weddingId: new Types.ObjectId(),
      customerId: new Types.ObjectId(customerId),
      vendorId: new Types.ObjectId(vendorId),
      quoteId: new Types.ObjectId(),
      category: VendorCategory.VENUE,
      status,
      eventDate: new Date('2026-02-14'),
      totalAmount: 400_000_00,
      paidAmount,
      advanceAmount: 100_000_00,
      commissionBps: 1000,
      cancellationTiers: [],
    });
    return booking.id as string;
  };

  it('derives the vendor rating from the reviews, not from whatever was seeded', async () => {
    const { id: vendorId } = await aVendor();
    expect((await vendorModel.findById(vendorId))?.reviewCount).toBe(0);

    const alice = await aCustomer('Priya Sharma');
    const bob = await aCustomer('Arjun Reddy');

    await reviews.create(alice, {
      bookingId: await aBooking(alice, vendorId),
      scores: scores(5),
      title: 'Beautiful venue',
      body,
    });
    await reviews.create(bob, {
      bookingId: await aBooking(bob, vendorId),
      scores: scores(4),
      title: 'Solid',
      body,
    });

    const vendor = await vendorModel.findById(vendorId);
    expect(vendor?.rating).toBe(4.5);
    expect(vendor?.reviewCount).toBe(2);
  });

  it('signs the review with a first name and a last initial, never the full name', async () => {
    const { id: vendorId } = await aVendor();
    const customerId = await aCustomer('Priya Sharma');

    const review = await reviews.create(customerId, {
      bookingId: await aBooking(customerId, vendorId),
      scores: scores(5),
      title: 'Beautiful venue',
      body,
    });

    expect(review.authorName).toBe('Priya S.');
  });

  it('publishes what was paid as a band, never the figure', async () => {
    const { id: vendorId } = await aVendor();
    const customerId = await aCustomer('Priya Sharma');

    const review = await reviews.create(customerId, {
      bookingId: await aBooking(customerId, vendorId, BookingStatus.COMPLETED, 350_000_00),
      scores: scores(5),
      title: 'Beautiful venue',
      body,
    });

    expect(review.amountBand).toBe('₹2 – 5 lakh');
    expect(JSON.stringify(review)).not.toContain('35000000');
  });

  it('refuses a second review of the same booking', async () => {
    const { id: vendorId } = await aVendor();
    const customerId = await aCustomer('Priya Sharma');
    const bookingId = await aBooking(customerId, vendorId);

    await reviews.create(customerId, {
      bookingId,
      scores: scores(5),
      title: 'Beautiful venue',
      body,
    });

    await expect(
      reviews.create(customerId, {
        bookingId,
        scores: scores(1),
        title: 'Changed my mind',
        body,
      }),
    ).rejects.toMatchObject({ status: 409 });

    // And the rating still reflects one review, not a half-applied second.
    const vendor = await vendorModel.findById(vendorId);
    expect(vendor?.rating).toBe(5);
    expect(vendor?.reviewCount).toBe(1);
  });

  it('refuses to review a booking that is not finished', async () => {
    const { id: vendorId } = await aVendor();
    const customerId = await aCustomer('Priya Sharma');

    await expect(
      reviews.create(customerId, {
        bookingId: await aBooking(customerId, vendorId, BookingStatus.ACCEPTED),
        scores: scores(5),
        title: 'Looking forward to it',
        body,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('answers a booking belonging to someone else with 404, not 403', async () => {
    const { id: vendorId } = await aVendor();
    const owner = await aCustomer('Priya Sharma');
    const stranger = await aCustomer('Arjun Reddy');
    const bookingId = await aBooking(owner, vendorId);

    // 403 would confirm the booking exists, which is the thing being protected.
    await expect(
      reviews.create(stranger, {
        bookingId,
        scores: scores(1),
        title: 'Terrible',
        body,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('summarises the spread, not just the average', async () => {
    const { id: vendorId } = await aVendor();
    for (const n of [5, 5, 5, 1]) {
      const customerId = await aCustomer('Reviewer ' + n);
      await reviews.create(customerId, {
        bookingId: await aBooking(customerId, vendorId),
        scores: scores(n),
        title: 'A review',
        body,
      });
    }

    const summary = await reviews.summaryFor(vendorId);
    expect(summary.count).toBe(4);
    expect(summary.average).toBe(4);
    // Index 0 is five stars: three of them, and one at the bottom.
    expect(summary.histogram).toEqual([3, 0, 0, 0, 1]);
    expect(summary.averages.value).toBe(4);
  });

  it('tells a customer whether they have already reviewed a booking', async () => {
    const { id: vendorId } = await aVendor();
    const customerId = await aCustomer('Priya Sharma');
    const stranger = await aCustomer('Arjun Reddy');
    const bookingId = await aBooking(customerId, vendorId);

    expect(await reviews.forBooking(customerId, bookingId)).toBeNull();

    await reviews.create(customerId, {
      bookingId,
      scores: scores(5),
      title: 'Beautiful venue',
      body,
    });

    expect(await reviews.forBooking(customerId, bookingId)).toMatchObject({
      title: 'Beautiful venue',
    });
    // Scoped to the caller: it is not a way to read someone else's review.
    expect(await reviews.forBooking(stranger, bookingId)).toBeNull();
  });

  it('lets the vendor answer once, and never delete', async () => {
    const { id: vendorId, ownerId } = await aVendor();
    const customerId = await aCustomer('Priya Sharma');
    const review = await reviews.create(customerId, {
      bookingId: await aBooking(customerId, vendorId),
      scores: scores(2),
      title: 'Disappointing',
      body,
    });

    const replied = await reviews.reply(ownerId, review.id, 'We are sorry, and we have fixed it.');
    expect(replied.vendorReply?.body).toBe('We are sorry, and we have fixed it.');

    await expect(
      reviews.reply(ownerId, review.id, 'Actually, let me add something.'),
    ).rejects.toMatchObject({ status: 409 });

    // The review survives the reply intact.
    const { items } = await reviews.listForVendor(vendorId);
    expect(items).toHaveLength(1);
    expect(items[0].rating).toBe(2);
  });

  it('will not let one vendor reply to a review of another', async () => {
    const { id: vendorId } = await aVendor();
    const stranger = new Types.ObjectId().toString();
    const customerId = await aCustomer('Priya Sharma');
    const review = await reviews.create(customerId, {
      bookingId: await aBooking(customerId, vendorId),
      scores: scores(2),
      title: 'Disappointing',
      body,
    });

    await expect(
      reviews.reply(stranger, review.id, 'This was not us.'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('carries the newest review onto the search card, trimmed at a word', async () => {
    const { id: vendorId } = await aVendor();

    const older = await aCustomer('Meghana Rao');
    await reviews.create(older, {
      bookingId: await aBooking(older, vendorId),
      scores: scores(5),
      title: 'The older one',
      body,
    });

    const newer = await aCustomer('Priya Sharma');
    await reviews.create(newer, {
      bookingId: await aBooking(newer, vendorId),
      scores: scores(4),
      title: 'The newer one',
      // Long enough to be cut, and no word straddling the 160-character mark
      // by accident - the point of the assertion is where the cut lands.
      body: 'They ran the sangeet without a single thing going wrong. '.repeat(6),
    });

    const { items } = await vendors.search({ category: VendorCategory.VENUE });
    const card = items.find((v) => v.id === vendorId);

    // Newest, not highest-rated: a card that always quotes five stars is an
    // advertisement, and people learn to skip advertisements.
    expect(card?.topReview?.title).toBe('The newer one');
    expect(card?.topReview?.authorName).toBe('Priya S.');
    expect(card?.topReview?.excerpt.endsWith('…')).toBe(true);
    expect(card?.topReview?.excerpt).not.toMatch(/\s…$/);
    // Trimmed at a word boundary, so it never ends mid-word.
    expect(card?.topReview?.excerpt.replace('…', '')).toMatch(/[a-z.]$/);
  });

  it('leaves topReview null for a vendor nobody has reviewed', async () => {
    const { id: vendorId } = await aVendor();

    const { items } = await vendors.search({ category: VendorCategory.VENUE });
    const card = items.find((v) => v.id === vendorId);

    expect(card).toBeDefined();
    expect(card?.topReview).toBeNull();
  });

  it('reports a vendor with no reviews as zero, not as unrated-but-scored', async () => {
    const { id: vendorId } = await aVendor();
    const summary = await reviews.summaryFor(vendorId);

    expect(summary).toEqual({
      average: 0,
      count: 0,
      histogram: [0, 0, 0, 0, 0],
      averages: { quality: 0, professionalism: 0, value: 0, flexibility: 0 },
    });
  });
});
