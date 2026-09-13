import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../core/decorators.js';
import { Throttle } from '../../core/throttle/throttle.guard.js';
import { FILE_STORAGE, type FileStorage } from './storage/file-storage.interface.js';

/** Keys are `<prefix>/<32 hex>.<ext>`; anything else is not one of ours. */
const KEY_SEGMENT = /^[a-z0-9-]{1,40}$/;
const KEY_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

/**
 * Serves stored files back to the browser.
 *
 * Public by necessity: an `<img>` tag cannot send an Authorization header, so a
 * guarded URL would simply not render. What protects an unapproved photo is the
 * key itself - 128 random bits, minted by the storage driver and handed out
 * only through DTOs the caller was already allowed to read. The read side
 * decides who learns a URL; this endpoint only decides whether a URL resolves.
 *
 * That is the same bargain every object store makes with a pre-signed URL, and
 * it is worth naming: anyone holding the link can fetch the bytes. Photos are
 * not secrets once shared, but they are unguessable.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  /**
   * Generously throttled, and deliberately so.
   *
   * The anonymous default is 20 requests a minute across the whole API, which
   * is the right shape for endpoints that do work but is nonsense for images: a
   * single visit to the category grid asks for nineteen tiles, and a listing
   * page asks for one per card. Under the default the public marketplace broke
   * its own photographs - the first few rendered, the rest came back 429 and
   * drew as broken-image icons.
   *
   * A high ceiling rather than no ceiling. Serving a file is cheap but not
   * free, and this is the one public endpoint that reads from disk or S3, so it
   * stays bounded against somebody looping over it.
   */
  @Get(':prefix/:name')
  @Public()
  @Throttle({ limit: 600, ttlMs: 60_000 })
  @ApiOperation({ summary: 'Fetch a stored file by its key' })
  async serve(
    @Param('prefix') prefix: string,
    @Param('name') name: string,
    @Res() res: Response,
  ): Promise<void> {
    // Validated before it reaches the driver: the key comes from a URL, and the
    // shape check is what keeps traversal attempts from ever being a path.
    if (!KEY_SEGMENT.test(prefix) || !KEY_NAME.test(name)) {
      throw new NotFoundException();
    }

    const file = await this.storage.read(`${prefix}/${name}`);
    if (!file) throw new NotFoundException();

    // The key is content-addressed by randomness: a given key's bytes never
    // change, so this can be cached hard. Replacing a photo mints a new key.
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Length', file.bytes.length);
    // Belt and braces: never let a stored file be interpreted as markup.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(file.bytes);
  }
}
