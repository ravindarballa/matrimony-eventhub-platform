import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { KycStatus, MAX_VENDOR_PHOTOS } from '@eventhub/contracts';

import { VendorsModule } from '../src/modules/vendors/vendors.module.js';
import { VendorsService } from '../src/modules/vendors/services/vendors.service.js';
import { Vendor } from '../src/modules/vendors/schemas/vendor.schema.js';
import type { VendorDocument } from '../src/modules/vendors/schemas/vendor.schema.js';

/**
 * A vendor's portfolio.
 *
 * The gallery is the strongest signal a couple has when choosing between two
 * venues they cannot visit, so it has to survive the ordinary editing a vendor
 * does to it: removing the cover, reordering which shot leads, and being told
 * no when they try to upload something that is not a photograph.
 */
describe('Vendor portfolio (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let vendors: VendorsService;
  let vendorModel: Model<VendorDocument>;
  let uploadRoot: string;

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(64, 0x20),
  ]);

  const image = (buffer = PNG, mimetype = 'image/png') => ({
    originalname: 'shot.png',
    mimetype,
    size: buffer.length,
    buffer,
  });

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uploadRoot = await mkdtemp(join(tmpdir(), 'eventhub-portfolio-'));

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ media: { localRoot: uploadRoot }, nodeEnv: 'test' })],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        VendorsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    vendors = moduleRef.get(VendorsService);
    vendorModel = moduleRef.get(getModelToken(Vendor.name));
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    await rm(uploadRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await vendorModel.deleteMany({});
    await rm(join(uploadRoot, 'vendor-portfolio'), { recursive: true, force: true });
  });

  /** A verified vendor, ready to have a portfolio built on it. */
  const vendor = async (): Promise<string> => {
    const ownerId = new Types.ObjectId().toString();
    await vendors.onboard(ownerId, {
      businessName: 'Sunrise Banquets',
      category: 'VENUE',
      city: 'Hyderabad',
      description: 'A banquet hall on the lake, seating six hundred.',
    });
    await vendorModel.updateOne(
      { ownerId: new Types.ObjectId(ownerId) },
      { $set: { kycStatus: KycStatus.VERIFIED, isActive: true } },
    );
    return ownerId;
  };

  const filesOnDisk = async (): Promise<string[]> => {
    try {
      return await readdir(join(uploadRoot, 'vendor-portfolio'));
    } catch {
      return [];
    }
  };

  it('starts empty rather than undefined', async () => {
    const ownerId = await vendor();
    const dto = await vendors.findMine(ownerId);
    expect(dto.photos).toEqual([]);
  });

  it('stores the file and makes the first upload the cover', async () => {
    const ownerId = await vendor();

    const dto = await vendors.addPortfolioPhoto(ownerId, image(), 'The lawn at dusk');

    expect(dto.photos).toHaveLength(1);
    expect(dto.photos[0]!.isCover).toBe(true);
    expect(dto.photos[0]!.caption).toBe('The lawn at dusk');
    expect(dto.photos[0]!.url).toMatch(
      /^\/api\/v1\/media\/vendor-portfolio\/[a-f0-9]{32}\.png$/,
    );
    expect(await filesOnDisk()).toHaveLength(1);
  });

  /**
   * No moderation gate here, unlike a matrimony photo: KYC already vets the
   * business, and holding the gallery would stall the listing.
   */
  it('is visible immediately, with no moderation step', async () => {
    const ownerId = await vendor();
    await vendors.addPortfolioPhoto(ownerId, image());

    const found = await vendors.findOne(
      (await vendors.findMine(ownerId)).id,
    );
    expect(found.photos).toHaveLength(1);
  });

  it('surfaces the cover first, whichever was uploaded first', async () => {
    const ownerId = await vendor();

    await vendors.addPortfolioPhoto(ownerId, image(), 'one');
    const two = await vendors.addPortfolioPhoto(ownerId, image(JPEG, 'image/jpeg'), 'two');

    const secondId = two.photos.find((p) => p.caption === 'two')!.id;
    const after = await vendors.setCoverPhoto(ownerId, secondId);

    expect(after.photos[0]!.id).toBe(secondId);
    expect(after.photos[0]!.isCover).toBe(true);
    expect(after.photos.filter((p) => p.isCover)).toHaveLength(1);
  });

  it('promotes another shot when the cover is removed', async () => {
    const ownerId = await vendor();

    const first = await vendors.addPortfolioPhoto(ownerId, image(), 'one');
    await vendors.addPortfolioPhoto(ownerId, image(), 'two');

    const after = await vendors.removePortfolioPhoto(ownerId, first.photos[0]!.id);

    expect(after.photos).toHaveLength(1);
    expect(after.photos[0]!.isCover).toBe(true);
    expect(await filesOnDisk()).toHaveLength(1);
  });

  it('refuses a file that is not the image it claims to be', async () => {
    const ownerId = await vendor();

    await expect(
      vendors.addPortfolioPhoto(ownerId, {
        originalname: 'brochure.png',
        mimetype: 'image/png',
        size: 30,
        buffer: Buffer.from('%PDF-1.7 not a png at all'),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(await filesOnDisk()).toHaveLength(0);
  });

  it('caps the gallery', async () => {
    const ownerId = await vendor();

    for (let i = 0; i < MAX_VENDOR_PHOTOS; i++) {
      await vendors.addPortfolioPhoto(ownerId, image());
    }
    await expect(vendors.addPortfolioPhoto(ownerId, image())).rejects.toMatchObject({
      status: 409,
    });

    expect(await filesOnDisk()).toHaveLength(MAX_VENDOR_PHOTOS);
  });

  it('404s on a photo belonging to another vendor', async () => {
    const owner = await vendor();
    const stranger = await vendor();

    const dto = await vendors.addPortfolioPhoto(owner, image());

    await expect(
      vendors.removePortfolioPhoto(stranger, dto.photos[0]!.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  /** Search cards are the whole point of having a cover at all. */
  it('carries the portfolio into search results', async () => {
    const ownerId = await vendor();
    await vendors.addPortfolioPhoto(ownerId, image(), 'hero');

    const { items } = await vendors.search({ category: 'VENUE', city: 'Hyderabad' });

    expect(items).toHaveLength(1);
    expect(items[0]!.photos[0]!.caption).toBe('hero');
    expect(items[0]!.photos[0]!.isCover).toBe(true);
  });
});
