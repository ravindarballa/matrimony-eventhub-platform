import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder, just enough for seed imagery.
 *
 * The seed needs pictures that are real image files - the upload path checks
 * magic bytes, and the browser has to render them - but committing a folder of
 * stock photographs to a repository to make a demo look nice is a poor trade.
 * Generating them keeps the seed self-contained and makes each vendor's gallery
 * visually distinct at a glance, which is all a demo needs.
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

/** Runs pixel(x, y) over the frame and wraps the result in a PNG. */
function encode(width, height, pixel) {
  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const rgb = pixel(x, y);
      for (let i = 0; i < 3; i++) {
        raw[o++] = Math.max(0, Math.min(255, Math.round(rgb[i])));
      }
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

/**
 * A flat colour block with a darker lower third. Used for vendor galleries,
 * where the point is only that each vendor looks different from the next.
 */
export function solidPng(width, height, [r, g, b]) {
  return encode(width, height, (x, y) => {
    const f = y > (height * 2) / 3 ? 0.72 : 1;
    return [r * f, g * f, b * f];
  });
}

/**
 * A head-and-shoulders silhouette on a coloured ground, for seeded profiles.
 *
 * Photographs of real people are deliberately not an option here. A matrimony
 * profile is a claim about a person, and putting a real face on a fabricated
 * one - an actor's publicity still, say - is the exact shape of the fraud these
 * platforms spend their lives fighting, quite apart from the photograph being
 * someone else's copyright. A drawn silhouette says "a person, no photo yet"
 * honestly, fills the frame at the right aspect ratio, and costs a kilobyte.
 *
 * Swap these for licensed portrait photography whenever there is some: only the
 * seed calls this, and the profile stores whatever URL it is given.
 */
export function portraitPng(width, height, [r, g, b], femaleShape = false) {
  const ground = [r * 0.9, g * 0.9, b * 0.9];
  const figure = [r + (255 - r) * 0.5, g + (255 - g) * 0.5, b + (255 - b) * 0.5];
  const hair = [r * 0.5, g * 0.5, b * 0.5];

  const cx = width / 2;
  const headR = width * 0.16;
  const headY = height * 0.38;

  // Shoulders are an ellipse rising from just below the frame, so the figure is
  // cropped the way a real head-and-shoulders photograph would be.
  const shoulderRx = width * (femaleShape ? 0.44 : 0.4);
  const shoulderRy = height * 0.4;
  const shoulderY = height * 1.06;

  const hairR = headR * 1.26;
  const hairDrop = femaleShape ? headR * 1.6 : headR * 0.15;

  return encode(width, height, (x, y) => {
    const dx = x - cx;
    const dyShoulder = y - shoulderY;
    if (
      (dx * dx) / (shoulderRx * shoulderRx) +
        (dyShoulder * dyShoulder) / (shoulderRy * shoulderRy) <=
      1
    ) {
      return figure;
    }

    const dyHead = y - headY;
    const fromHead = dx * dx + dyHead * dyHead;
    if (fromHead <= headR * headR) return figure;
    if (fromHead <= hairR * hairR && y < headY + hairDrop) return hair;

    return ground;
  });
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
