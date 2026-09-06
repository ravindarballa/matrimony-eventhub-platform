import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { FileStorage, StoredFile } from './file-storage.interface.js';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Objects in S3, for anything running more than one API process.
 *
 * The local driver keeps files on the box that received the upload, which is
 * correct for one developer and wrong the moment a second instance exists: the
 * process serving the photo is rarely the one that stored it. This is the
 * driver that makes the media endpoint work behind a load balancer.
 *
 * Objects are written private. They are still served through the media
 * controller rather than straight from the bucket, so the platform keeps one
 * URL shape across both drivers and the bucket needs no public policy - the
 * unguessable key remains the only thing standing between a link and the
 * bytes, exactly as it does locally.
 */
@Injectable()
export class S3Storage implements FileStorage {
  readonly name = 's3';

  private readonly logger = new Logger(S3Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('media.s3.bucket');
    this.client = new S3Client({
      region: config.getOrThrow<string>('media.s3.region'),
      // Credentials are deliberately not read from configuration: on AWS they
      // come from the task or instance role, and a codebase that accepts keys
      // in env vars invites someone to paste long-lived ones there.
      ...(config.get<string>('media.s3.endpoint')
        ? {
            endpoint: config.get<string>('media.s3.endpoint'),
            forcePathStyle: true,
          }
        : {}),
    });
  }

  async put(params: {
    prefix: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<StoredFile> {
    const ext = EXTENSIONS[params.contentType] ?? 'bin';
    const key = `${params.prefix}/${randomBytes(16).toString('hex')}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.bytes,
        ContentType: params.contentType,
      }),
    );

    return { key, url: `/api/v1/media/${key}` };
  }

  async remove(key: string): Promise<void> {
    // S3 delete is already idempotent - a missing key is a successful delete -
    // so this matches the local driver's contract without extra handling.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) return null;

      const bytes = Buffer.from(await res.Body.transformToByteArray());
      const ext = key.split('.').pop() ?? '';
      return {
        bytes,
        contentType:
          res.ContentType ?? EXTENSION_TYPES[ext] ?? 'application/octet-stream',
      };
    } catch (err) {
      // A missing object is a 404 to the caller, not an error worth logging at
      // any volume; anything else is worth knowing about.
      const name = (err as { name?: string }).name;
      if (name !== 'NoSuchKey' && name !== 'NotFound') {
        this.logger.warn(`S3 read failed for ${key}: ${String(err)}`);
      }
      return null;
    }
  }
}
