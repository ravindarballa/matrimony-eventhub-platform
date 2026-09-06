/**
 * The storage boundary.
 *
 * Everything the platform needs from a file store is expressed here, so no
 * service ever imports a cloud SDK. It mirrors the payment gateway: one
 * interface, a local implementation for development and tests (no credentials,
 * no network), and room for an S3 implementation without touching a caller.
 *
 * Keys are opaque to callers. A caller hands over bytes and gets a key and a
 * URL back; how those map onto a disk path or a bucket object is the driver's
 * business alone.
 */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface StoredFile {
  /** The handle the object is addressed by later. Opaque; never parsed. */
  key: string;
  /** Where a browser can fetch it from. */
  url: string;
}

/**
 * One uploaded file, as multer hands it over.
 *
 * Declared here rather than imported from @types/multer, which is not a
 * dependency of this project: these four fields are the whole of what the
 * platform uses, and naming them keeps the upload path free of an ambient
 * global type.
 */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface FileStorage {
  readonly name: string;

  /**
   * Stores bytes and returns how to reach them.
   *
   * `prefix` groups related objects (for example 'profile-photos'); the driver
   * is free to use it as a folder or to ignore it. The key must be
   * unguessable - a photo awaiting moderation is reachable by URL alone, so a
   * sequential name would let anyone walk the store.
   */
  put(params: {
    prefix: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<StoredFile>;

  /** Removes an object. Missing objects are not an error - deletion is idempotent. */
  remove(key: string): Promise<void>;

  /** The bytes and content type behind a key, or null when there is no such object. */
  read(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
}
