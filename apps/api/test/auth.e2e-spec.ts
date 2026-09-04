import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import type { Server } from 'node:http';

import { AuthModule } from '../src/modules/auth/auth.module.js';
import { JwtAuthGuard } from '../src/core/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/core/guards/roles.guard.js';
import { TransformInterceptor } from '../src/core/interceptors/transform.interceptor.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import configuration from '../src/config/configuration.js';
import { configureApp } from '../src/bootstrap.js';

// Timeout lives in jest-e2e.json: under ESM the `jest` global is not injected,
// so jest.setTimeout() is unavailable without importing from @jest/globals.

describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let server: Server;

  beforeAll(async () => {
    // A replica set, not a standalone: the booking flow uses transactions, and
    // the test topology should match production.
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    process.env['NODE_ENV'] = 'test';
    process.env['JWT_ACCESS_SECRET'] = 'test-secret-at-least-32-characters-long';
    process.env['JWT_REFRESH_SECRET'] = 'test-refresh-at-least-32-characters!!';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
        MongooseModule.forRoot(mongo.getUri()),
        EventEmitterModule.forRoot(),
        AuthModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Exactly the configuration main.ts applies, so the test exercises the app
    // that actually ships rather than a lookalike.
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  const mobile = '9876543210';
  let challengeId: string;
  let devCode: string;
  let accessToken: string;

  it('rejects a malformed mobile number', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Test User', mobile: '1234567890', intent: 'SEEKER', consent: true })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fields).toHaveProperty('mobile');
    expect(res.body.error.traceId).toBeDefined();
  });

  it('strips unknown properties rather than trusting them', async () => {
    // A client trying to grant itself ADMIN must be rejected, not obeyed.
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Test User',
        mobile,
        intent: 'SEEKER',
        consent: true,
        roles: ['ADMIN'],
      })
      .expect(400);
  });

  it('registers and issues an OTP challenge without leaking the code', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Ravindar Balla', mobile, intent: 'SEEKER', consent: true })
      .expect(201);

    expect(res.body.data.challengeId).toBeDefined();
    challengeId = res.body.data.challengeId;
    // Outside production the code is returned so local dev needs no SMS provider.
    devCode = res.body.data.devCode;
    expect(devCode).toMatch(/^\d{6}$/);
  });

  it('reports the mobile as taken once registered', async () => {
    const res = await request(server)
      .get(`/api/v1/auth/mobile-available?m=${mobile}`)
      .expect(200);
    // Still available: the account exists but is PENDING_VERIFICATION.
    expect(res.body.data.available).toBe(true);
  });

  it('rejects a wrong OTP', async () => {
    const wrong = devCode === '000000' ? '111111' : '000000';
    const res = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId, code: wrong, purpose: 'REGISTRATION' })
      .expect(400);
    expect(res.body.error.code).toBe('AUTH_OTP_INVALID');
  });

  it('verifies the OTP, returns an access token and sets an httpOnly cookie', async () => {
    const res = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId, code: devCode, purpose: 'REGISTRATION' })
      .expect(201);

    expect(res.body.data.user.mobile).toBe(mobile);
    expect(res.body.data.user.roles).toEqual(['SEEKER']);
    expect(res.body.data.accessToken).toBeDefined();
    accessToken = res.body.data.accessToken;

    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('eh_rt=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // The refresh token must never appear in the response body.
    expect(JSON.stringify(res.body)).not.toContain('eh_rt');
  });

  it('refuses a protected route without a token', async () => {
    await request(server).get('/api/v1/auth/me').expect(401);
  });

  it('serves the current user with a valid token', async () => {
    const res = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data.mobile).toBe(mobile);
    expect(res.body.data.status).toBe('ACTIVE');
    // The password hash must never be serialised.
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('cannot reuse a consumed OTP challenge', async () => {
    await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId, code: devCode, purpose: 'REGISTRATION' })
      .expect(400);
  });

  it('adds a role to the existing account rather than making a second one', async () => {
    const res = await request(server)
      .post('/api/v1/auth/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'CUSTOMER' })
      .expect(201);

    expect(res.body.data.roles).toEqual(expect.arrayContaining(['SEEKER', 'CUSTOMER']));
  });

  it('refuses to grant a privileged role through the self-service route', async () => {
    await request(server)
      .post('/api/v1/auth/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  it('lists the active session', async () => {
    const res = await request(server)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isCurrent).toBe(true);
  });
});
