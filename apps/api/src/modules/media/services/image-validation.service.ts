import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  ErrorCode,
  MAX_PHOTO_BYTES,
} from '@eventhub/contracts';

import type { UploadedImage } from '../storage/file-storage.interface.js';

/**
 * Whether an uploaded file is an image the platform will store.
 *
 * Shared because every upload path needs exactly the same answer, and the one
 * check that matters - the magic bytes - is the one most likely to be
 * forgotten when a second feature copies the first. A profile photo and a
 * vendor's portfolio shot are the same problem.
 */
@Injectable()
export class ImageValidationService {
  /** Throws a 400 with a field message if the file is not usable. */
  assertUsable(file: UploadedImage): void {
    const fail = (message: string): never => {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        fields: { file: message },
      });
    };

    if (!file?.buffer?.length) fail('That file is empty.');
    if (file.size > MAX_PHOTO_BYTES) {
      fail(`Photos must be under ${Math.floor(MAX_PHOTO_BYTES / (1024 * 1024))} MB.`);
    }
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype as never)) {
      fail('Use a JPEG, PNG or WebP image.');
    }
    // The declared type is the client's word for it. Someone who wants to store
    // something else will simply claim it is a JPEG; the bytes are what settle it.
    if (sniffImageType(file.buffer) !== file.mimetype) {
      fail('That file is not the image type it claims to be.');
    }
  }
}

/**
 * The real type of an image, from its leading bytes.
 *
 * Deliberately tiny and dependency-free: it recognises exactly the three
 * formats the platform accepts and returns null for everything else, which is
 * all an upload path needs in order to refuse a mislabelled file.
 */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
