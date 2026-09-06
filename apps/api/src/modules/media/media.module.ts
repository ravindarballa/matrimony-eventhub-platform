import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MediaController } from './media.controller.js';
import { FILE_STORAGE } from './storage/file-storage.interface.js';
import { LocalDiskStorage } from './storage/local-disk.storage.js';

/**
 * File storage, and the endpoint that serves it back.
 *
 * Imported explicitly by whichever feature stores files rather than declared
 * global: a feature that saves a photo depends on storage, and saying so keeps
 * that module testable on its own instead of failing to resolve a token no
 * import mentions.
 *
 * Only the local driver is wired today. An S3 driver implementing FileStorage
 * drops in here behind the same token, chosen by configuration, exactly as the
 * payment gateway picks between the fake and Razorpay.
 */
@Module({
  // ConfigModule explicitly, rather than relying on the app having made it
  // global: the local driver reads its root from configuration, and a module
  // that can only be constructed inside the full application is a module no
  // feature can test on its own.
  imports: [ConfigModule],
  controllers: [MediaController],
  providers: [{ provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  exports: [FILE_STORAGE],
})
export class MediaModule {}
