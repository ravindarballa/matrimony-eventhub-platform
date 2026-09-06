import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { MediaController } from './media.controller.js';
import { FILE_STORAGE } from './storage/file-storage.interface.js';
import { LocalDiskStorage } from './storage/local-disk.storage.js';
import { S3Storage } from './storage/s3.storage.js';
import { ImageValidationService } from './services/image-validation.service.js';

/**
 * File storage, and the endpoint that serves it back.
 *
 * Imported explicitly by whichever feature stores files rather than declared
 * global: a feature that saves a photo depends on storage, and saying so keeps
 * that module testable on its own instead of failing to resolve a token no
 * import mentions.
 *
 * Two drivers behind one token, chosen by configuration exactly as the payment
 * gateway picks between the fake and Razorpay: local disk for development and
 * tests, S3 for anything running more than one process. Nothing above this
 * module knows which one it is talking to.
 */
@Module({
  // ConfigModule explicitly, rather than relying on the app having made it
  // global: the drivers read their settings from configuration, and a module
  // that can only be constructed inside the full application is a module no
  // feature can test on its own.
  imports: [ConfigModule],
  controllers: [MediaController],
  providers: [
    LocalDiskStorage,
    {
      provide: FILE_STORAGE,
      // Built through a factory so the S3 client - and its getOrThrow on bucket
      // and region - is only constructed when S3 is actually the configured
      // driver. Listing S3Storage as an ordinary provider would instantiate it
      // on every boot and break local development outright.
      useFactory: (config: ConfigService, local: LocalDiskStorage) =>
        config.get<string>('media.driver') === 's3' ? new S3Storage(config) : local,
      inject: [ConfigService, LocalDiskStorage],
    },
    ImageValidationService,
  ],
  exports: [FILE_STORAGE, ImageValidationService],
})
export class MediaModule {}
