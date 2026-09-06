import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import type { Model } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { MAX_PROFILE_PHOTOS } from '@eventhub/contracts';

import { configureApp } from '../src/bootstrap.js';
import { MatrimonyModule } from '../src/modules/matrimony/matrimony.module.js';
import { ProfilesService } from '../src/modules/matrimony/services/profiles.service.js';
import { MatrimonyProfile } from '../src/modules/matrimony/schemas/matrimony-profile.schema.js';
import { User } from '../src/modules/auth/schemas/user.schema.js';
import type { MatrimonyProfileDocument } from '../src/modules/matrimony/schemas/matrimony-profile.schema.js';
import type { UserDocument } from '../src/modules/auth/schemas/user.schema.js';

/**
 * Profile photos, from the upload to the bytes coming back out.
 *
 * The photo pipeline existed on paper long before anything could put a photo
 * into it - the schema, the moderation queue and the blur rules were all built
 * against an array nothing ever appended to. These tests exercise the half that
 * was missing, and in particular the two things a photo feature gets wrong:
 * accepting a file that is not the image it claims to be, and letting an
 * unreviewed photo become the face of a profile.
 */
describe('Profile photos (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let profiles: ProfilesService;
  let profileModel: Model<MatrimonyProfileDocument>;
  let userModel: Model<UserDocument>;
  let uploadRoot: string;

  /** A real 1x1 PNG - the sniffer checks magic bytes, so this cannot be fake. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  /** A real JPEG header, enough for the sniffer to accept it. */
  const JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(64, 0x20),
  ]);

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uploadRoot = await mkdtemp(join(tmpdir(), 'eventhub-media-'));

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ media: { localRoot: uploadRoot }, nodeEnv: 'test' })],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        MatrimonyModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    profiles = moduleRef.get(ProfilesService);
    profileModel = moduleRef.get(getModelToken(MatrimonyProfile.name));
    userModel = moduleRef.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    await rm(uploadRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await Promise.all([profileModel.deleteMany({}), userModel.deleteMany({})]);
    // The store is shared across tests, so it is reset alongside the database -
    // otherwise a file count is really a count of everything uploaded so far.
    await rm(join(uploadRoot, 'profile-photos'), { recursive: true, force: true });
  });

  /** A member with a profile, ready to have photos hung off it. */
  const member = async (mobile = '9812300001'): Promise<string> => {
    const user = await userModel.create({
      fullName: 'Photo Tester',
      mobile,
      roles: ['SEEKER'],
      status: 'ACTIVE',
      mobileVerified: true,
    });
    const userId = user._id.toString();

    await profiles.upsert(userId, {
      displayName: 'Photo Tester',
      gender: 'FEMALE',
      dateOfBirth: new Date(Date.UTC(1998, 3, 12)).toISOString(),
      heightCm: 162,
      religion: 'Hindu',
      community: 'Reddy',
      city: 'Hyderabad',
      motherTongue: 'Telugu',
      managedBy: 'SELF',
    } as never);

    return userId;
  };

  const filesOnDisk = async (): Promise<string[]> => {
    try {
      return await readdir(join(uploadRoot, 'profile-photos'));
    } catch {
      return [];
    }
  };

  describe('uploading', () => {
    it('stores the file and hangs a pending photo off the profile', async () => {
      const userId = await member();

      const dto = await profiles.addPhoto(userId, {
        originalname: 'me.png',
        mimetype: 'image/png',
        size: PNG.length,
        buffer: PNG,
      });

      expect(dto.photos).toHaveLength(1);
      expect(dto.photos[0]!.moderation).toBe('PENDING');
      // The first photo is primary, so one upload is never a profile with no face.
      expect(dto.photos[0]!.isPrimary).toBe(true);
      expect(dto.photos[0]!.url).toMatch(/^\/api\/v1\/media\/profile-photos\/[a-f0-9]{32}\.png$/);

      expect(await filesOnDisk()).toHaveLength(1);
    });

    /**
     * Completeness is worth 10 points for photos, and those points are for an
     * APPROVED photo. An upload that scored immediately would let anyone buy
     * search ranking with a file nobody had looked at.
     */
    it('does not award completeness until a photo is approved', async () => {
      const userId = await member();

      const before = await profiles.addPhoto(userId, {
        originalname: 'me.png',
        mimetype: 'image/png',
        size: PNG.length,
        buffer: PNG,
      });
      const pendingScore = before.completeness;

      const profile = await profileModel.findOne({ userId: new Types.ObjectId(userId) });
      profile!.photos[0]!.moderation = 'APPROVED';
      profile!.completeness = profiles.completeness(profile!);
      await profile!.save();

      expect(profile!.completeness).toBeGreaterThan(pendingScore);
    });

    /**
     * The content type is the client's word for it. A .exe renamed to .png and
     * declared as image/png has to fail on what the bytes actually are.
     */
    it('refuses a file that is not the image type it claims to be', async () => {
      const userId = await member();

      await expect(
        profiles.addPhoto(userId, {
          originalname: 'trojan.png',
          mimetype: 'image/png',
          size: 20,
          buffer: Buffer.from('MZ\x90\x00 this is not a png'),
        }),
      ).rejects.toMatchObject({ status: 400 });

      expect(await filesOnDisk()).toHaveLength(0);
    });

    it('refuses a format that is not on the list', async () => {
      const userId = await member();

      await expect(
        profiles.addPhoto(userId, {
          originalname: 'drawing.svg',
          mimetype: 'image/svg+xml',
          size: 40,
          buffer: Buffer.from('<svg onload="alert(1)"></svg>'),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('caps the album and says so', async () => {
      const userId = await member();

      for (let i = 0; i < MAX_PROFILE_PHOTOS; i++) {
        await profiles.addPhoto(userId, {
          originalname: `${i}.jpg`,
          mimetype: 'image/jpeg',
          size: JPEG.length,
          buffer: JPEG,
        });
      }

      await expect(
        profiles.addPhoto(userId, {
          originalname: 'one-too-many.jpg',
          mimetype: 'image/jpeg',
          size: JPEG.length,
          buffer: JPEG,
        }),
      ).rejects.toMatchObject({ status: 409 });

      expect(await filesOnDisk()).toHaveLength(MAX_PROFILE_PHOTOS);
    });
  });

  describe('managing', () => {
    it('promotes another photo when the primary one is removed', async () => {
      const userId = await member();

      const first = await profiles.addPhoto(userId, {
        originalname: 'a.png', mimetype: 'image/png', size: PNG.length, buffer: PNG,
      });
      await profiles.addPhoto(userId, {
        originalname: 'b.png', mimetype: 'image/png', size: PNG.length, buffer: PNG,
      });

      const primaryId = first.photos[0]!.id;
      const after = await profiles.removePhoto(userId, primaryId);

      expect(after.photos).toHaveLength(1);
      expect(after.photos[0]!.isPrimary).toBe(true);
      // The bytes go too - a removed photo must not stay fetchable by URL.
      expect(await filesOnDisk()).toHaveLength(1);
    });

    /**
     * The primary photo is what a stranger sees on a search card. Allowing a
     * pending one to be primary would route around moderation entirely.
     */
    it('will not make an unreviewed photo the primary one', async () => {
      const userId = await member();

      await profiles.addPhoto(userId, {
        originalname: 'a.png', mimetype: 'image/png', size: PNG.length, buffer: PNG,
      });
      const second = await profiles.addPhoto(userId, {
        originalname: 'b.png', mimetype: 'image/png', size: PNG.length, buffer: PNG,
      });
      const pendingId = second.photos[1]!.id;

      await expect(profiles.setPrimaryPhoto(userId, pendingId)).rejects.toMatchObject({
        status: 409,
      });

      const profile = await profileModel.findOne({ userId: new Types.ObjectId(userId) });
      profile!.photos[1]!.moderation = 'APPROVED';
      await profile!.save();

      const after = await profiles.setPrimaryPhoto(userId, pendingId);
      expect(after.photos.find((p) => p.id === pendingId)!.isPrimary).toBe(true);
      // Exactly one primary, always.
      expect(after.photos.filter((p) => p.isPrimary)).toHaveLength(1);
    });

    it('404s on a photo that is not yours', async () => {
      const owner = await member('9812300001');
      const stranger = await member('9812300002');

      const dto = await profiles.addPhoto(owner, {
        originalname: 'a.png', mimetype: 'image/png', size: PNG.length, buffer: PNG,
      });

      await expect(
        profiles.removePhoto(stranger, dto.photos[0]!.id),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('serving over HTTP', () => {
    it('gives the bytes back at the URL the DTO advertised', async () => {
      const userId = await member();
      const dto = await profiles.addPhoto(userId, {
        originalname: 'me.png', mimetype: 'image/png', size: PNG.length, buffer: PNG,
      });

      const res = await request(app.getHttpServer()).get(dto.photos[0]!.url).expect(200);

      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(res.body as Buffer).equals(PNG)).toBe(true);
    });

    /**
     * The key arrives straight from a URL, so `..` in it is the difference
     * between serving an upload and serving whatever else is on the disk.
     */
    it('refuses a key that tries to climb out of the store', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/media/profile-photos/..%2f..%2f..%2fpackage.json')
        .expect(404);
    });

    it('404s an unknown key rather than erroring', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/media/profile-photos/${'a'.repeat(32)}.png`)
        .expect(404);
    });
  });
});
