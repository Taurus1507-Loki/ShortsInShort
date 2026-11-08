import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config/env.js';
import { v4 as uuidv4 } from 'uuid';

export type StorageProvider = 'local' | 'r2';

export interface UploadResult {
  url: string;
  key: string;
  provider: StorageProvider;
  size: number;
}

export interface PresignedUploadUrl {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  expiresIn: number;
}

export interface StorageService {
  upload(key: string, body: Buffer | Uint8Array | ReadableStream, contentType: string): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  getPresignedUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<PresignedUploadUrl>;
  getPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  getPublicUrl(key: string): string;
}

class LocalStorageService implements StorageService {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = config.storage.local.uploadsDir;
  }

  async upload(key: string, body: Buffer | Uint8Array | ReadableStream, _contentType: string): Promise<UploadResult> {
    const fs = await import('fs');
    const path = await import('path');
    const fullPath = path.resolve(this.uploadsDir, key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    let buffer: Buffer;
    if (body instanceof Buffer) {
      buffer = body;
    } else if (body instanceof Uint8Array) {
      buffer = Buffer.from(body);
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);
    }

    await fs.promises.writeFile(fullPath, buffer);
    return { url: `/uploads/${key}`, key, provider: 'local', size: buffer.length };
  }

  async delete(key: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const fullPath = path.resolve(this.uploadsDir, key);
    try {
      await fs.promises.unlink(fullPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async getPresignedUploadUrl(key: string, _contentType: string, _expiresIn = 3600): Promise<PresignedUploadUrl> {
    return {
      uploadUrl: `/api/upload/presigned?key=${encodeURIComponent(key)}`,
      key,
      publicUrl: `/uploads/${key}`,
      expiresIn: 3600,
    };
  }

  async getPresignedDownloadUrl(key: string, _expiresIn = 3600): Promise<string> {
    return `/uploads/${key}`;
  }

  getPublicUrl(key: string): string {
    return `/uploads/${key}`;
  }
}

class R2StorageService implements StorageService {
  private client: S3Client;
  private bucketName: string;
  private publicUrl: string;

  constructor() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.storage.r2.accessKeyId,
        secretAccessKey: config.storage.r2.secretAccessKey,
      },
    });
    this.bucketName = config.storage.r2.bucketName;
    this.publicUrl = config.storage.r2.publicUrl || `https://${config.storage.r2.bucketName}.${config.storage.r2.accountId}.r2.cloudflarestorage.com`;
  }

  private getKeyPath(key: string): string {
    return key.startsWith('/') ? key.slice(1) : key;
  }

  async upload(key: string, body: Buffer | Uint8Array | ReadableStream, contentType: string): Promise<UploadResult> {
    const finalKey = this.getKeyPath(key);
    let buffer: Buffer;
    if (body instanceof Buffer) {
      buffer = body;
    } else if (body instanceof Uint8Array) {
      buffer = Buffer.from(body);
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);
    }

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: finalKey,
      Body: buffer,
      ContentType: contentType,
    }));

    return { url: `${this.publicUrl}/${finalKey}`, key: finalKey, provider: 'r2', size: buffer.length };
  }

  async delete(key: string): Promise<void> {
    const finalKey = this.getKeyPath(key);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: finalKey,
    }));
  }

  async getPresignedUploadUrl(key: string, contentType: string, expiresIn = 3600): Promise<PresignedUploadUrl> {
    const finalKey = this.getKeyPath(key);
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: finalKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return { uploadUrl, key: finalKey, publicUrl: `${this.publicUrl}/${finalKey}`, expiresIn };
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const finalKey = this.getKeyPath(key);
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: finalKey,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  getPublicUrl(key: string): string {
    const finalKey = this.getKeyPath(key);
    return `${this.publicUrl}/${finalKey}`;
  }
}

export function getStorageService(): StorageService {
  if (config.storage.provider === 'r2' && config.storage.r2.accountId && config.storage.r2.accessKeyId) {
    return new R2StorageService();
  }
  return new LocalStorageService();
}

export function generateStorageKey(userId: string, type: 'raw' | 'processed' | 'thumbnails' | 'avatars' | 'audio', extension: string): string {
  const uniqueId = uuidv4().slice(0, 8);
  const timestamp = Date.now();
  return `${type}/${userId}/${timestamp}-${uniqueId}.${extension}`;
}