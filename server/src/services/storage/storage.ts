import { createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { env } from '../../config/env.js';
import { safeEqual } from '../../utils/crypto.js';

export interface UploadTarget {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Object storage abstraction. Keys are opaque, tenant-prefixed paths (`ws/<workspaceId>/…`).
 * The bucket is private: browsers only ever get short-lived signed URLs.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  createUploadTarget(key: string, contentType: string, maxBytes: number, expiresSec?: number): Promise<UploadTarget>;
  getDownloadUrl(key: string, opts?: { expiresSec?: number; downloadName?: string }): Promise<string>;
  /** A path or URL FFmpeg/FFprobe can read directly. */
  getProcessingInput(key: string): Promise<string>;
  downloadToFile(key: string, dest: string): Promise<void>;
  uploadFile(key: string, src: string, contentType: string): Promise<void>;
  stat(key: string): Promise<{ size: number } | null>;
  readHead(key: string, bytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9/_.-]{1,512}$/;
export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..') || key.startsWith('/')) throw new Error(`Unsafe storage key: ${key}`);
}

/* ── Local disk driver (development / single server) ─────────────────── */

export type LocalOp = 'get' | 'put';

export function signLocal(op: LocalOp, key: string, exp: number, max = 0, name = ''): string {
  return createHmac('sha256', env.storage.signingSecret).update(`${op}\n${key}\n${exp}\n${max}\n${name}`).digest('base64url');
}

export function verifyLocalSignature(op: LocalOp, key: string, exp: number, max: number, name: string, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signLocal(op, key, exp, max, name), sig);
}

class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  constructor(private readonly root: string) {}

  resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Path escapes storage root');
    return full;
  }

  private url(op: LocalOp, key: string, expiresSec: number, max = 0, name = '') {
    const exp = Math.floor(Date.now() / 1000) + expiresSec;
    const qs = new URLSearchParams({ exp: String(exp), sig: signLocal(op, key, exp, max, name) });
    if (max) qs.set('max', String(max));
    if (name) qs.set('name', name);
    return { url: `/api/storage/${op}/${key}?${qs}`, exp };
  }

  async createUploadTarget(key: string, contentType: string, maxBytes: number, expiresSec = 3600): Promise<UploadTarget> {
    const { url, exp } = this.url('put', key, expiresSec, maxBytes);
    return { method: 'PUT', url, headers: { 'Content-Type': contentType }, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async getDownloadUrl(key: string, opts: { expiresSec?: number; downloadName?: string } = {}) {
    return this.url('get', key, opts.expiresSec ?? 3600, 0, opts.downloadName ?? '').url;
  }

  async getProcessingInput(key: string) {
    return this.resolve(key);
  }

  async downloadToFile(key: string, dest: string) {
    await copyFile(this.resolve(key), dest);
  }

  async uploadFile(key: string, src: string) {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  /**
   * Streams a request body to disk, aborting once `maxBytes` is exceeded. Write-once: the file is
   * opened with `wx`, so a key that already holds bytes (e.g. an upload that has already been
   * validated) can never be overwritten through a still-valid signed URL.
   */
  async writeStream(key: string, body: Readable, maxBytes: number): Promise<number> {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    let bytes = 0;
    const out = createWriteStream(dest, { flags: 'wx' });
    try {
      await pipeline(
        body,
        async function* (source) {
          for await (const chunk of source) {
            bytes += (chunk as Buffer).length;
            if (bytes > maxBytes) throw Object.assign(new Error('Upload exceeds allowed size'), { code: 'TOO_LARGE' });
            yield chunk;
          }
        },
        out,
      );
    } catch (err) {
      // EEXIST means the file belongs to an earlier, completed write: leave it untouched.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(new Error('File already uploaded'), { code: 'ALREADY_EXISTS' });
      await rm(dest, { force: true });
      throw err;
    }
    return bytes;
  }

  async stat(key: string) {
    try {
      const s = await stat(this.resolve(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async readHead(key: string, bytes: number) {
    const fh = await open(this.resolve(key), 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  createReadStream(key: string) {
    return createReadStream(this.resolve(key));
  }
}

/* ── S3-compatible driver (Cloudflare R2 / AWS S3) ───────────────────── */
// NOTE: requires credentials; not exercised by the local test suite. Verify against your bucket
// before relying on it (see docs/PHASE2.md).

class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client>;

  constructor(private readonly cfg: NonNullable<typeof env.storage.s3>) {
    this.clientPromise = import('@aws-sdk/client-s3').then(
      ({ S3Client }) =>
        new S3Client({
          region: cfg.region,
          endpoint: cfg.endpoint,
          forcePathStyle: cfg.forcePathStyle,
          credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
        }),
    );
  }

  private async sign(command: object, expiresIn: number) {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(await this.clientPromise, command as never, { expiresIn });
  }

  async createUploadTarget(key: string, contentType: string, _maxBytes: number, expiresSec = 3600): Promise<UploadTarget> {
    assertSafeKey(key);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    // Presigned PUT can't cap size; the /complete step verifies size via HEAD and deletes oversize objects.
    const url = await this.sign(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType }), expiresSec);
    return { method: 'PUT', url, headers: { 'Content-Type': contentType }, expiresAt: new Date(Date.now() + expiresSec * 1000).toISOString() };
  }

  async getDownloadUrl(key: string, opts: { expiresSec?: number; downloadName?: string } = {}) {
    assertSafeKey(key);
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    return this.sign(
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentDisposition: opts.downloadName ? `attachment; filename="${opts.downloadName.replace(/"/g, '')}"` : undefined,
      }),
      opts.expiresSec ?? 3600,
    );
  }

  getProcessingInput(key: string) {
    return this.getDownloadUrl(key, { expiresSec: 2 * 3600 });
  }

  async downloadToFile(key: string, dest: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    await pipeline(res.Body as Readable, createWriteStream(dest));
  }

  async uploadFile(key: string, src: string, contentType: string) {
    assertSafeKey(key);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { size } = await stat(src);
    await (await this.clientPromise).send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: createReadStream(src), ContentType: contentType, ContentLength: size }),
    );
  }

  async stat(key: string) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const r = await (await this.clientPromise).send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0) };
    } catch {
      return null;
    }
  }

  async readHead(key: string, bytes: number) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const r = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async delete(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

export const localStorage = new LocalStorage(env.storage.localDir);
export const storage: StorageDriver = env.storage.s3 ? new S3Storage(env.storage.s3) : localStorage;

export const keys = {
  upload: (workspaceId: string, assetId: string, ext: string) => `ws/${workspaceId}/uploads/${assetId}.${ext}`,
  render: (workspaceId: string, assetId: string) => `ws/${workspaceId}/renders/${assetId}.mp4`,
  thumbnail: (workspaceId: string, assetId: string) => `ws/${workspaceId}/thumbnails/${assetId}.jpg`,
  narration: (workspaceId: string, assetId: string) => `ws/${workspaceId}/audio/${assetId}.mp3`,
  avatarVideo: (workspaceId: string, assetId: string) => `ws/${workspaceId}/avatars/${assetId}.mp4`,
  /** Shared (not workspace-owned) generated voice samples. */
  voiceSample: (provider: string, voiceId: string, language: string) => `system/voice-samples/${provider}/${voiceId}-${language}.mp3`,
};
