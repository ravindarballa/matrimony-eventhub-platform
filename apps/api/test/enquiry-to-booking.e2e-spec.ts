import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import {
  BookingStatus,
  EnquiryVendorStatus,
  GST_BPS,
  KycStatus,
} from '@eventhub/contracts';

import { configureApp } from '../src/bootstrap.js';
import { EventsModule } from '../src/modules/events/events.module.js';
import { OtpService } from '../src/modules/auth/services/otp.service.js';
import { User } from '../src/modules/auth/schemas/user.schema.js';
import { VendorsModule } from '../src/modules/vendors/vendors.module.js';
import { EnquiriesService } from '../src/modules/events/services/enquiries.service.js';
import { BookingsService } from '../src/modules/events/services/bookings.service.js';
import { VendorsService } from '../src/modules/vendors/services/vendors.service.js';
import { Vendor } from '../src/modules/vendors/schemas/vendor.schema.js';
import { VendorService as VendorServiceEntity } from '../src/modules/vendors/schemas/vendor-service.schema.js';
import { Enquiry } from '../src/modules/events/schemas/enquiry.schema.js';
import { Quote } from '../src/modules/events/schemas/quote.schema.js';
import { Wedding } from '../src/modules/events/schemas/wedding.schema.js';
import { Booking } from '../src/modules/events/schemas/booking.schema.js';
import { VendorAvailability } from '../src/modules/events/schemas/vendor-availability.schema.js';
import type { VendorDocument } from '../src/modules/vendors/schemas/vendor.schema.js';
import type { VendorServiceDocument } from '../src/modules/vendors/schemas/vendor-service.schema.js';
import type { EnquiryDocument } from '../src/modules/events/schemas/enquiry.schema.js';
import type { QuoteDocument } from '../src/modules/events/schemas/quote.schema.js';
import type { WeddingDocument } from '../src/modules/events/schemas/wedding.schema.js';
import type { BookingDocument } from '../src/modules/events/schemas/booking.schema.js';
import type { VendorAvailabilityDocument } from '../src/modules/events/schemas/vendor-availability.schema.js';

/**
 * The middle of the funnel, end to end: a verified vendor with a catalogue is
 * found by search, sent an enquiry, answers with a quote, and the customer
 * accepts it into a booking that holds the date.
 *
 * Before this existed a quote could only be produced by writing to Mongo by
 * hand, which meant the half of the product a customer actually walks through
 * was never exercised.
 */
describe('Enquiry to booking (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let enquiries: EnquiriesService;
  let otp: OtpService;
  let userModel: Model<Record<string, unknown>>;
  let bookings: BookingsService;
  let vendorsService: VendorsService;

  let vendorModel: Model<VendorDocument>;
  let serviceModel: Model<VendorServiceDocument>;
  let enquiryModel: Model<EnquiryDocument>;
  let quoteModel: Model<QuoteDocument>;
  let weddingModel: Model<WeddingDocument>;
  let bookingModel: Model<BookingDocument>;
  let availability: Model<VendorAvailabilityDocument>;

  /** Six months out, so refunds land in the most generous tier. */
  const FUNCTION_DATE = new Date(Date.UTC(2027, 1, 14)).toISOString();

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // The guest flow signs people in, which needs signing keys.
          load: [
            () => ({
              jwt: {
                accessSecret: 'test-access-secret-at-least-32-characters',
                accessTtl: 900,
                refreshSecret: 'test-refresh-secret-at-least-32-chars',
                refreshTtl: 2_592_000,
              },
              otp: { ttlSeconds: 600, maxAttempts: 5 },
              nodeEnv: 'test',
            }),
          ],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        VendorsModule,
        EventsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // The same pipes, prefix and versioning main.ts applies. Without this the
    // HTTP tests below would exercise a different app than the one that ships -
    // in particular no ValidationPipe, so no DTO would ever be checked.
    configureApp(app);
    await app.init();

    enquiries = moduleRef.get(EnquiriesService);
    otp = moduleRef.get(OtpService);
    userModel = moduleRef.get(getModelToken(User.name));
    bookings = moduleRef.get(BookingsService);
    vendorsService = moduleRef.get(VendorsService);

    vendorModel = moduleRef.get(getModelToken(Vendor.name));
    serviceModel = moduleRef.get(getModelToken(VendorServiceEntity.name));
    enquiryModel = moduleRef.get(getModelToken(Enquiry.name));
    quoteModel = moduleRef.get(getModelToken(Quote.name));
    weddingModel = moduleRef.get(getModelToken(Wedding.name));
    bookingModel = moduleRef.get(getModelToken(Booking.name));
    availability = moduleRef.get(getModelToken(VendorAvailability.name));

    await Promise.all([
      vendorModel.syncIndexes(),
      serviceModel.syncIndexes(),
      enquiryModel.syncIndexes(),
      quoteModel.syncIndexes(),
      weddingModel.syncIndexes(),
      bookingModel.syncIndexes(),
      availability.syncIndexes(),
    ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      vendorModel.deleteMany({}),
      serviceModel.deleteMany({}),
      enquiryModel.deleteMany({}),
      quoteModel.deleteMany({}),
      weddingModel.deleteMany({}),
      bookingModel.deleteMany({}),
      availability.deleteMany({}),
      userModel.deleteMany({}),
    ]);
  });

  /** A vendor that has been onboarded, verified, and has one package listed. */
  const verifiedVendor = async (
    overrides: { businessName?: string; city?: string; basePrice?: number } = {},
  ) => {
    const ownerId = new Types.ObjectId().toString();
    const vendor = await vendorsService.onboard(ownerId, {
      businessName: overrides.businessName ?? 'Sunrise Banquets',
      category: 'VENUE',
      city: overrides.city ?? 'Pune',
      description: 'A large banquet hall with parking and in-house catering.',
    });

    await vendorsService.submitKyc(ownerId, {
      pan: 'ABCDE1234F',
      bankAccountName: 'Sunrise Banquets',
      bankAccountNumber: '123456789012',
      ifsc: 'HDFC0001234',
    });
    await vendorsService.decideKyc(vendor.id, { decision: 'VERIFIED' });

    await vendorsService.addService(ownerId, {
      title: 'Full day hall hire',
      description: 'Exclusive use of the main hall for one day.',
      pricingModel: 'PER_DAY',
      basePrice: (overrides.basePrice ?? 400_000_00) as never,
      capacity: 800,
      inclusions: ['Parking', 'Generator backup'],
    });

    return { ownerId, vendorId: vendor.id };
  };

  const weddingFor = async (customerId: string) =>
    enquiries.createWedding(customerId, {
      brideName: 'Anita',
      groomName: 'Rahul',
      primaryDate: FUNCTION_DATE,
      city: 'Pune',
      guestEstimate: 500,
      budgetTotal: 2_000_000_00 as never,
    });

  // ---------------------------------------------------------------- onboarding

  describe('vendor onboarding', () => {
    it('refuses a second listing for the same owner', async () => {
      const ownerId = new Types.ObjectId().toString();
      const dto = {
        businessName: 'Sunrise Banquets',
        category: 'VENUE' as const,
        city: 'Pune',
        description: 'A large banquet hall with parking and in-house catering.',
      };

      await vendorsService.onboard(ownerId, dto);
      await expect(vendorsService.onboard(ownerId, dto)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('keeps bank details out of ordinary reads', async () => {
      const { vendorId } = await verifiedVendor();

      // The DTO has no bank fields at all, and the document does not carry them
      // unless a caller explicitly selects them.
      const dto = await vendorsService.findOne(vendorId);
      expect(JSON.stringify(dto)).not.toContain('123456789012');

      const doc = await vendorModel.findById(vendorId);
      expect(doc!.kyc).toBeUndefined();
    });

    it('will not verify a rejection without a reason', async () => {
      const { vendorId } = await verifiedVendor();
      await expect(
        vendorsService.decideKyc(vendorId, { decision: 'REJECTED' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('tells a rejected vendor what to fix', async () => {
      const { vendorId } = await verifiedVendor();
      const rejected = await vendorsService.decideKyc(vendorId, {
        decision: 'REJECTED',
        reason: 'The bank proof is unreadable.',
      });

      expect(rejected.kycStatus).toBe(KycStatus.REJECTED);
      expect(rejected.kycRejectionReason).toBe('The bank proof is unreadable.');
    });
  });

  // -------------------------------------------------------------------- search

  describe('search', () => {
    it('finds a vendor by category and city, cheapest price surfaced', async () => {
      await verifiedVendor({ basePrice: 400_000_00 });

      const { items, total } = await vendorsService.search({
        category: 'VENUE',
        city: 'pune', // lower case on purpose
      });

      expect(total).toBe(1);
      expect(items[0]!.businessName).toBe('Sunrise Banquets');
      expect(items[0]!.priceFrom).toBe(400_000_00);
      expect(items[0]!.services).toHaveLength(1);
    });

    it('drops vendors whose calendar is already taken on the date', async () => {
      const { ownerId, vendorId } = await verifiedVendor();
      const customerId = new Types.ObjectId().toString();
      void ownerId;

      // Somebody else already holds that date.
      await availability.create({
        vendorId: new Types.ObjectId(vendorId),
        date: new Date(Date.UTC(2027, 1, 14)),
        status: 'HELD',
      });
      void customerId;

      const free = await vendorsService.search({ category: 'VENUE' });
      expect(free.items).toHaveLength(1);

      const onDate = await vendorsService.search({
        category: 'VENUE',
        date: FUNCTION_DATE,
      });
      // A result you cannot book is not a result.
      expect(onDate.items).toHaveLength(0);
    });

    it('sorts by price when asked', async () => {
      await verifiedVendor({ businessName: 'Cheap Hall', basePrice: 100_000_00 });
      await verifiedVendor({ businessName: 'Grand Hall', basePrice: 900_000_00 });

      const { items } = await vendorsService.search({ sort: 'price' });
      expect(items.map((v) => v.businessName)).toEqual(['Cheap Hall', 'Grand Hall']);
    });
  });

  // ----------------------------------------------------------------- enquiries

  describe('enquiry fan-out', () => {
    it('sends one enquiry to several vendors at once', async () => {
      const a = await verifiedVendor({ businessName: 'Hall A' });
      const b = await verifiedVendor({ businessName: 'Hall B' });
      const customerId = new Types.ObjectId().toString();
      const wedding = await weddingFor(customerId);

      const enquiry = await enquiries.create(customerId, {
        weddingId: wedding.id,
        category: 'VENUE',
        functionType: 'WEDDING',
        functionDate: FUNCTION_DATE,
        guestCount: 500,
        vendorIds: [a.vendorId, b.vendorId],
      });

      expect(enquiry.vendors).toHaveLength(2);
      expect(enquiry.vendors.every((v) => v.status === EnquiryVendorStatus.SENT)).toBe(
        true,
      );
      // The city comes from the wedding, not the request.
      expect(enquiry.city).toBe('Pune');
    });

    it('refuses to send to a vendor who has not passed KYC', async () => {
      const ownerId = new Types.ObjectId().toString();
      const unverified = await vendorsService.onboard(ownerId, {
        businessName: 'Unverified Hall',
        category: 'VENUE',
        city: 'Pune',
        description: 'A hall that has not completed verification yet.',
      });

      const customerId = new Types.ObjectId().toString();
      const wedding = await weddingFor(customerId);

      await expect(
        enquiries.create(customerId, {
          weddingId: wedding.id,
          category: 'VENUE',
          functionType: 'WEDDING',
          functionDate: FUNCTION_DATE,
          guestCount: 500,
          vendorIds: [unverified.id],
        }),
      ).rejects.toMatchObject({ status: 409 });

      // Nothing was written: the check happens before any leg is created.
      expect(await enquiryModel.countDocuments()).toBe(0);
    });

    it('refuses a vendor from another category', async () => {
      const { vendorId } = await verifiedVendor();
      const customerId = new Types.ObjectId().toString();
      const wedding = await weddingFor(customerId);

      await expect(
        enquiries.create(customerId, {
          weddingId: wedding.id,
          category: 'CATERING', // the vendor is a VENUE
          functionType: 'WEDDING',
          functionDate: FUNCTION_DATE,
          guestCount: 500,
          vendorIds: [vendorId],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("refuses an enquiry against someone else's wedding", async () => {
      const { vendorId } = await verifiedVendor();
      const owner = new Types.ObjectId().toString();
      const attacker = new Types.ObjectId().toString();
      const wedding = await weddingFor(owner);

      await expect(
        enquiries.create(attacker, {
          weddingId: wedding.id,
          category: 'VENUE',
          functionType: 'WEDDING',
          functionDate: FUNCTION_DATE,
          guestCount: 500,
          vendorIds: [vendorId],
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('shows the vendor their leg with the SLA clock running', async () => {
      const { ownerId, vendorId } = await verifiedVendor();
      const customerId = new Types.ObjectId().toString();
      const wedding = await weddingFor(customerId);

      await enquiries.create(customerId, {
        weddingId: wedding.id,
        category: 'VENUE',
        functionType: 'WEDDING',
        functionDate: FUNCTION_DATE,
        guestCount: 500,
        notes: 'Vegetarian only, 500 guests.',
        vendorIds: [vendorId],
      });

      const inbox = await enquiries.inboxForVendor(ownerId);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!.status).toBe(EnquiryVendorStatus.SENT);
      expect(inbox[0]!.notes).toBe('Vegetarian only, 500 guests.');
      expect(inbox[0]!.hoursRemaining).toBeGreaterThan(23);
    });

    it('never shows one vendor another vendor’s enquiry', async () => {
      const a = await verifiedVendor({ businessName: 'Hall A' });
      const b = await verifiedVendor({ businessName: 'Hall B' });
      const customerId = new Types.ObjectId().toString();
      const wedding = await weddingFor(customerId);

      await enquiries.create(customerId, {
        weddingId: wedding.id,
        category: 'VENUE',
        functionType: 'WEDDING',
        functionDate: FUNCTION_DATE,
        guestCount: 500,
        vendorIds: [a.vendorId],
      });

      expect(await enquiries.inboxForVendor(a.ownerId)).toHaveLength(1);
      expect(await enquiries.inboxForVendor(b.ownerId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------- quotes

  describe('quoting', () => {
    const openEnquiry = async () => {
      const vendor = await verifiedVendor();
      const customerId = new Types.ObjectId().toString();
      const wedding = await weddingFor(customerId);
      const enquiry = await enquiries.create(customerId, {
        weddingId: wedding.id,
        category: 'VENUE',
        functionType: 'WEDDING',
        functionDate: FUNCTION_DATE,
        guestCount: 500,
        vendorIds: [vendor.vendorId],
      });
      return { ...vendor, customerId, enquiry };
    };

    it('recomputes every total from the line items', async () => {
      const { ownerId, enquiry } = await openEnquiry();

      const quote = await enquiries.quote(ownerId, enquiry.id, {
        lineItems: [
          { description: 'Hall hire', quantity: 1, unitPrice: 400_000_00 as never },
          { description: 'Extra hours', quantity: 3, unitPrice: 10_000_00 as never },
        ],
        advancePercent: 25,
        validForDays: 7,
      });

      // 4,00,000 + 3 x 10,000 = 4,30,000, plus 18% GST.
      expect(quote.subtotal).toBe(430_000_00);
      expect(quote.gstAmount).toBe(Math.round((430_000_00 * GST_BPS) / 10_000));
      expect(quote.total).toBe(quote.subtotal + quote.gstAmount);
      expect(quote.lineItems[1]!.lineTotal).toBe(30_000_00);
    });

    it('marks the leg quoted and records the response time', async () => {
      const { ownerId, vendorId, enquiry } = await openEnquiry();

      await enquiries.quote(ownerId, enquiry.id, {
        lineItems: [
          { description: 'Hall hire', quantity: 1, unitPrice: 400_000_00 as never },
        ],
        advancePercent: 25,
        validForDays: 7,
      });

      const stored = await enquiryModel.findById(enquiry.id);
      const leg = stored!.vendors[0]!;
      expect(leg.status).toBe(EnquiryVendorStatus.QUOTED);
      expect(leg.quoteId).toBeDefined();

      // Median response time is a ranking input, so it must be recorded.
      const vendor = await vendorModel.findById(vendorId);
      expect(vendor!.medianResponseMins).toBe(0); // answered immediately
      expect(vendor!.recentResponseMins).toHaveLength(1);
    });

    it('refuses a second quote for the same enquiry', async () => {
      const { ownerId, enquiry } = await openEnquiry();
      const body = {
        lineItems: [
          { description: 'Hall hire', quantity: 1, unitPrice: 400_000_00 as never },
        ],
        advancePercent: 25,
        validForDays: 7,
      };

      await enquiries.quote(ownerId, enquiry.id, body);
      await expect(
        enquiries.quote(ownerId, enquiry.id, body),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('refuses an advance outside the platform bounds', async () => {
      const { ownerId, enquiry } = await openEnquiry();

      await expect(
        enquiries.quote(ownerId, enquiry.id, {
          lineItems: [
            { description: 'Hall hire', quantity: 1, unitPrice: 400_000_00 as never },
          ],
          advancePercent: 90, // the vendor would like 90% up front
          validForDays: 7,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('refuses a quote from a vendor who was never asked', async () => {
      const { enquiry } = await openEnquiry();
      const stranger = await verifiedVendor({ businessName: 'Uninvited Hall' });

      await expect(
        enquiries.quote(stranger.ownerId, enquiry.id, {
          lineItems: [
            { description: 'Hall hire', quantity: 1, unitPrice: 1_00 as never },
          ],
          advancePercent: 25,
          validForDays: 7,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('will not let a declined leg be quoted afterwards', async () => {
      const { ownerId, enquiry } = await openEnquiry();
      await enquiries.decline(ownerId, enquiry.id);

      await expect(
        enquiries.quote(ownerId, enquiry.id, {
          lineItems: [
            { description: 'Hall hire', quantity: 1, unitPrice: 400_000_00 as never },
          ],
          advancePercent: 25,
          validForDays: 7,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('expires legs nobody answered', async () => {
      const { enquiry } = await openEnquiry();
      await enquiryModel.updateOne(
        { _id: enquiry.id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      expect(await enquiries.expireStaleEnquiries()).toBe(1);
      const stored = await enquiryModel.findById(enquiry.id);
      expect(stored!.vendors[0]!.status).toBe(EnquiryVendorStatus.EXPIRED);
    });
  });

  describe('enquiring without an account', () => {
    const GUEST_MOBILE = '9812345678';

    /** What the browser does first: ask for a code. */
    const codeFor = async (mobile: string) => {
      const { challengeId, devCode } = await otp.issue(mobile, 'LOGIN');
      return { challengeId, code: devCode! };
    };

    const guestBody = async (vendorId: string, mobile = GUEST_MOBILE) => {
      const { challengeId, code } = await codeFor(mobile);
      return {
        fullName: 'Passing Visitor',
        mobile,
        otpChallengeId: challengeId,
        otpCode: code,
        city: 'Pune',
        category: 'VENUE' as const,
        functionType: 'WEDDING' as const,
        functionDate: FUNCTION_DATE,
        guestCount: 400,
        notes: 'Found you through search.',
        vendorIds: [vendorId],
      };
    };

    it('creates the account, the wedding and the enquiry in one call', async () => {
      const { vendorId } = await verifiedVendor();

      const result = await enquiries.createAsGuest(
        await guestBody(vendorId),
        { device: 'test', ip: '::1' },
      );

      expect(result.enquiry.vendors).toHaveLength(1);
      expect(result.enquiry.city).toBe('Pune');

      // An account now exists, verified, and able to use the wedding side.
      const user = await userModel.findOne({ mobile: GUEST_MOBILE });
      expect(user).not.toBeNull();
      expect(user!['roles']).toContain('CUSTOMER');
      expect(user!['mobileVerified']).toBe(true);
      expect(user!['status']).toBe('ACTIVE');

      // And they are signed in, so quotes are visible without a second step.
      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();

      expect(await weddingModel.countDocuments()).toBe(1);
    });

    it('refuses a wrong code, and creates nothing', async () => {
      const { vendorId } = await verifiedVendor();
      const body = await guestBody(vendorId);

      // The stable code matters more than the status here: a wrong code is a
      // bad request, not an authentication failure against an account that does
      // not exist yet.
      await expect(
        enquiries.createAsGuest({ ...body, otpCode: '000000' }, {}),
      ).rejects.toMatchObject({
        status: 400,
        response: { message: 'AUTH_OTP_INVALID' },
      });

      expect(await userModel.countDocuments({ mobile: GUEST_MOBILE })).toBe(0);
      expect(await enquiryModel.countDocuments()).toBe(0);
    });

    /**
     * The double-tap case. The code is consumed on use, so a replayed submit
     * fails rather than sending a second enquiry or forking the account.
     */
    it('cannot be replayed with the same code', async () => {
      const { vendorId } = await verifiedVendor();
      const body = await guestBody(vendorId);

      await enquiries.createAsGuest(body, {});
      await expect(enquiries.createAsGuest(body, {})).rejects.toMatchObject({
        status: 400,
        response: { message: 'AUTH_OTP_INVALID' },
      });

      expect(await enquiryModel.countDocuments()).toBe(1);
      // Only the guest: the test vendor is created with a synthetic owner id
      // and has no user row of its own.
      expect(await userModel.countDocuments()).toBe(1);
    });

    it('reuses an existing account rather than forking it', async () => {
      const { vendorId } = await verifiedVendor();

      await enquiries.createAsGuest(await guestBody(vendorId), {});
      const first = await userModel.findOne({ mobile: GUEST_MOBILE });

      await enquiries.createAsGuest(await guestBody(vendorId), {});
      const users = await userModel.find({ mobile: GUEST_MOBILE });

      expect(users).toHaveLength(1);
      expect(String(users[0]!._id)).toBe(String(first!._id));
      // One family, one wedding, two enquiries.
      expect(await weddingModel.countDocuments()).toBe(1);
      expect(await enquiryModel.countDocuments()).toBe(2);
    });

    it('checks the vendors before creating an account', async () => {
      const ownerId = new Types.ObjectId().toString();
      const unverified = await vendorsService.onboard(ownerId, {
        businessName: 'Unverified Hall',
        category: 'VENUE',
        city: 'Pune',
        description: 'A hall that has not completed verification yet.',
      });

      await expect(
        enquiries.createAsGuest(await guestBody(unverified.id), {}),
      ).rejects.toMatchObject({ status: 409 });

      // No stranded account left behind by a request that could never succeed.
      expect(await userModel.countDocuments({ mobile: GUEST_MOBILE })).toBe(0);
    });

    /**
     * Over HTTP, not through the service.
     *
     * Everything above calls createAsGuest directly, which skips the whole
     * controller - the DTO is never validated and the response is never
     * written. That is a real gap: the endpoint can be entirely broken while
     * those tests stay green, so the request the browser actually makes is
     * exercised here.
     */
    describe('over HTTP', () => {
      const url = '/api/v1/enquiries/guest';

      it('accepts the request a browser sends', async () => {
        const { vendorId } = await verifiedVendor();
        const body = await guestBody(vendorId);

        const res = await request(app.getHttpServer()).post(url).send(body).expect(201);

        expect(res.body.enquiry.id).toBeDefined();
        expect(res.body.accessToken).toEqual(expect.any(String));
        expect(res.body.user.mobile).toBe(GUEST_MOBILE);
      });

      /**
       * The session has to survive a page reload, which means the cookie must
       * carry the name and path /auth/refresh reads it back by. A cookie
       * written under any other spelling looks fine to the caller and silently
       * signs the guest out the moment they refresh.
       */
      it('sets the refresh cookie /auth/refresh can actually read', async () => {
        const { vendorId } = await verifiedVendor();

        const res = await request(app.getHttpServer())
          .post(url)
          .send(await guestBody(vendorId))
          .expect(201);

        const cookies = res.headers['set-cookie'] as unknown as string[];
        const refresh = cookies.find((c) => c.startsWith('eh_rt='));

        expect(refresh).toBeDefined();
        expect(refresh).toContain('Path=/api/v1/auth');
        expect(refresh).toContain('HttpOnly');
      });

      /**
       * The DTO has to accept a real code. A regex that matches nothing a user
       * can type rejects every valid submission with a 400, and no test that
       * calls the service directly would ever notice.
       */
      it('rejects a malformed code but accepts six digits', async () => {
        const { vendorId } = await verifiedVendor();
        const body = await guestBody(vendorId);

        await request(app.getHttpServer())
          .post(url)
          .send({ ...body, otpCode: '12ab' })
          .expect(400);

        // The same request with the untouched six-digit code goes through.
        await request(app.getHttpServer()).post(url).send(body).expect(201);
      });
    });
  });

  // ------------------------------------------------------- the whole funnel

  it('runs search -> enquiry -> quotes -> comparison -> booking', async () => {
    const cheap = await verifiedVendor({
      businessName: 'Cheap Hall',
      basePrice: 200_000_00,
    });
    const grand = await verifiedVendor({
      businessName: 'Grand Hall',
      basePrice: 600_000_00,
    });

    const customerId = new Types.ObjectId().toString();
    const wedding = await weddingFor(customerId);

    // 1. The customer searches for a bookable venue on their date.
    const { items } = await vendorsService.search({
      category: 'VENUE',
      city: 'Pune',
      date: FUNCTION_DATE,
    });
    expect(items).toHaveLength(2);

    // 2. Asks both.
    const enquiry = await enquiries.create(customerId, {
      weddingId: wedding.id,
      category: 'VENUE',
      functionType: 'WEDDING',
      functionDate: FUNCTION_DATE,
      guestCount: 500,
      vendorIds: items.map((v) => v.id),
    });

    // 3. Both answer.
    await enquiries.quote(grand.ownerId, enquiry.id, {
      lineItems: [
        { description: 'Hall hire', quantity: 1, unitPrice: 600_000_00 as never },
      ],
      advancePercent: 30,
      validForDays: 7,
    });
    await enquiries.quote(cheap.ownerId, enquiry.id, {
      lineItems: [
        { description: 'Hall hire', quantity: 1, unitPrice: 200_000_00 as never },
      ],
      advancePercent: 25,
      validForDays: 7,
    });

    // 4. The customer compares - cheapest first.
    const quotes = await enquiries.quotesForEnquiry(enquiry.id, customerId);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]!.total).toBeLessThan(quotes[1]!.total);

    // 5. And accepts one, which locks the date.
    const booking = await bookings.acceptQuote(quotes[0]!.id, customerId);
    expect(booking.status).toBe(BookingStatus.ACCEPTED);
    expect(booking.totalAmount).toBe(quotes[0]!.total);
    // 25% of the accepted total, computed server-side.
    expect(booking.advanceAmount).toBe(Math.round((quotes[0]!.total * 25) / 100));

    const slot = await availability.findOne({});
    expect(slot!.status).toBe('HELD');

    // 6. The losing vendor's date is untouched, and still searchable.
    const stillFree = await vendorsService.search({
      category: 'VENUE',
      date: FUNCTION_DATE,
    });
    expect(stillFree.items.map((v) => v.businessName)).toEqual(['Grand Hall']);
  });
});
