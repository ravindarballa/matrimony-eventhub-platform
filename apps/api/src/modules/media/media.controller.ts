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

  @Get(':prefix/:name')
  @Public()
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
