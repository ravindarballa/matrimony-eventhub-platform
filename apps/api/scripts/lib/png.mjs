import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder, just enough for seed imagery.
 *
 * The seed needs pictures that are real image files - the upload path checks
 * magic bytes, and the browser has to render them - but committing a folder of
 * stock photographs to a repository to make a demo look nice is a poor trade.
 * Generating flat colour blocks keeps the seed self-contained and makes each
 * vendor's gallery visually distinct at a glance, which is all a demo needs.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, payload, CRC over type+payload. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A solid rectangle as an 8-bit RGB PNG.
 *
 * `stripe` darkens the lower third, so a generated photo still reads as an
 * image rather than a failed load when it appears in a card.
 */
export function solidPng(width, height, [r, g, b]) {
  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const dark = y > (height * 2) / 3;
    for (let x = 0; x < width; x++) {
      raw[o++] = dark ? Math.round(r * 0.72) : r;
      raw[o++] = dark ? Math.round(g * 0.72) : g;
      raw[o++] = dark ? Math.round(b * 0.72) : b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10-12 are compression, filter and interlace methods; 0 is the only value.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A readable spread of colours, so each seeded gallery looks different. */
export const PALETTE = {
  saffron: [214, 148, 62],
  rose: [186, 92, 110],
  indigo: [72, 78, 140],
  teal: [58, 132, 128],
  plum: [120, 78, 122],
  moss: [104, 124, 78],
  clay: [172, 106, 84],
  slate: [92, 104, 120],
};
