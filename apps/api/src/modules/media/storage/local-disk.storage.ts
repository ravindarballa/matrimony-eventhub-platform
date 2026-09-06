import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { FileStorage, StoredFile } from './file-storage.interface.js';

/** Content type -> extension. Only the formats the platform accepts. */
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
 * Files on the local disk, served back through the media controller.
 *
 * This is the development and test driver - it needs no credentials and no
 * network, so a fresh clone can upload a photo immediately. Production is meant
 * to run an S3 driver behind the same interface; nothing above this class knows
 * which one it is talking to.
 *
 * Keys are random rather than derived from the filename. A profile photo is
 * reachable by URL before a moderator has seen it, so a guessable key would be
 * a way to browse other members' unapproved photos.
 */
@Injectable()
export class LocalDiskStorage implements FileStorage {
  readonly name = 'local-disk';

  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    // `??` is not enough here: an unset MEDIA_LOCAL_ROOT reaches config as an
    // empty string, which is not nullish, and resolve('') is the working
    // directory - which would scatter uploads through the app folder.
    const configured = config.get<string>('media.localRoot');
    this.root = resolve(
      configured && configured.trim()
        ? configured
        : join(process.cwd(), 'var', 'uploads'),
    );
  }

  async put(params: {
    prefix: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<StoredFile> {
    const ext = EXTENSIONS[params.contentType] ?? 'bin';
    const key = `${params.prefix}/${randomBytes(16).toString('hex')}.${ext}`;
    const path = this.pathFor(key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, params.bytes);

    return { key, url: `/api/v1/media/${key}` };
  }

  async remove(key: string): Promise<void> {
    const path = this.pathFor(key);
    // force:true so a key that is already gone is not an error - a delete that
    // races with another delete should still leave the caller with nothing.
    await rm(path, { force: true });
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const bytes = await readFile(this.pathFor(key));
      const ext = key.split('.').pop() ?? '';
      return { bytes, contentType: EXTENSION_TYPES[ext] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  /**
   * Resolves a key to a path inside the storage root, and refuses anything that
   * escapes it. The key reaches this class straight from a URL, so `..` in it
   * is the difference between serving an upload and serving /etc/passwd.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      this.logger.warn(`Refused a media key that escapes the store: ${key}`);
      throw new Error('Invalid media key');
    }
    return path;
  }
}
