import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import {
  MemoryThrottleStore,
  THROTTLE_STORE,
  ThrottleGuard,
  type ThrottleStore,
} from './core/throttle/throttle.guard.js';
import { RedisThrottleStore } from './core/throttle/redis-throttle.store.js';

import configuration from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter.js';
import { TransformInterceptor } from './core/interceptors/transform.interceptor.js';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard.js';
import { RolesGuard } from './core/guards/roles.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { MatrimonyModule } from './modules/matrimony/matrimony.module.js';
import { VendorsModule } from './modules/vendors/vendors.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongodbUri'),
        // Retryable writes need a replica set; local docker-compose provides one.
        retryWrites: true,
      }),
    }),

    EventEmitterModule.forRoot({ maxListeners: 32, verboseMemoryLeak: true }),
    ScheduleModule.forRoot(),

    // Feature modules. Each is a bounded context; they communicate through
    // domain events rather than by importing one another's services.
    AuthModule,
    MatrimonyModule,
    VendorsModule,
    EventsModule,
    PaymentsModule,
    NotificationsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    /**
     * Which rate-limit store is in use is configuration, not code. Local
     * development needs no Redis; anything running more than one task must set
     * THROTTLE_STORE=redis, or each task keeps its own counter and the limits
     * multiply by the number of tasks.
     */
    {
      provide: THROTTLE_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ThrottleStore => {
        if (config.get<string>('throttleStore') !== 'redis') {
          return new MemoryThrottleStore();
        }
        const redis = config.get<{ host: string; port: number }>('redis');
        return RedisThrottleStore.fromUrl(
          redis?.host ?? 'localhost',
          redis?.port ?? 6379,
        );
      },
    },

    // Order matters: authenticate, then authorise, then rate limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottleGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
