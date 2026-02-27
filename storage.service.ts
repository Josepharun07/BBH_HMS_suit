/**
 * BBH HMS – StorageService
 * Self-hosted S3-compatible object storage via MinIO.
 * Uses @aws-sdk/client-s3 (compatible with MinIO's S3 API).
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ─── Constants ─────────────────────────────────────────────────────────────

export const BUCKET_PRIVATE = 'bbh-private'; // Internal docs, not publicly accessible
export const BUCKET_PUBLIC  = 'bbh-public';  // Hotel images, logos, public assets

export type StorageBucket = typeof BUCKET_PRIVATE | typeof BUCKET_PUBLIC;

export interface UploadedFile {
  bucket: StorageBucket;
  key: string;       // Full path inside bucket
  url: string;       // Public URL (for bbh-public) or presigned URL
  sizeBytes: number;
  mimeType: string;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly publicEndpoint: string;

  constructor() {
    const endpoint = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`;
    this.publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT ?? endpoint;

    this.client = new S3Client({
      endpoint,
      region: 'us-east-1', // MinIO requires a region string; value is irrelevant
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
      },
      forcePathStyle: true, // REQUIRED for MinIO path-style addressing
    });
  }

  /**
   * On startup: ensure both buckets exist and set public policy on bbh-public.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureBucket(BUCKET_PUBLIC, true);
    await this.ensureBucket(BUCKET_PRIVATE, false);
    this.logger.log('MinIO buckets initialized');
  }

  /**
   * Upload a file buffer to a bucket.
   * Generates a unique key if none provided.
   *
   * @param fileBuffer - Raw file bytes
   * @param mimeType   - MIME type (e.g. "image/png")
   * @param bucket     - Target bucket
   * @param keyPrefix  - Optional path prefix (e.g. "logos/", "documents/staff/")
   * @param fileName   - Original filename (used to preserve extension)
   */
  async uploadFile(
    fileBuffer: Buffer,
    mimeType: string,
    bucket: StorageBucket,
    keyPrefix: string = '',
    fileName: string = 'file',
  ): Promise<UploadedFile> {
    const ext = path.extname(fileName) || this.mimeToExt(mimeType);
    const key = `${keyPrefix}${uuidv4()}${ext}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType,
          ContentLength: fileBuffer.length,
        }),
      );

      const url =
        bucket === BUCKET_PUBLIC
          ? `${this.publicEndpoint}/${bucket}/${key}`
          : await this.getPresignedUrl(bucket, key, 3600);

      this.logger.debug(`Uploaded ${key} to bucket ${bucket} (${fileBuffer.length} bytes)`);

      return {
        bucket,
        key,
        url,
        sizeBytes: fileBuffer.length,
        mimeType,
      };
    } catch (err: any) {
      this.logger.error(`Upload failed for ${key}: ${err.message}`);
      throw new InternalServerErrorException('File upload failed');
    }
  }

  /**
   * Delete an object from a bucket.
   */
  async deleteFile(bucket: StorageBucket, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
    this.logger.debug(`Deleted ${key} from ${bucket}`);
  }

  /**
   * Generate a time-limited presigned URL for private file access.
   * @param expiresInSeconds - Default 1 hour
   */
  async getPresignedUrl(
    bucket: StorageBucket,
    key: string,
    expiresInSeconds: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Stream a file from storage (for piping to HTTP response).
   */
  async streamFile(bucket: StorageBucket, key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return response.Body as Readable;
  }

  /**
   * List objects in a bucket with an optional prefix filter.
   */
  async listFiles(
    bucket: StorageBucket,
    prefix?: string,
  ): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    const response = await this.client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
    );

    return (response.Contents ?? []).map((obj) => ({
      key: obj.Key!,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
    }));
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private async ensureBucket(name: string, isPublic: boolean): Promise<void> {
    const exists = await this.client
      .send(new HeadBucketCommand({ Bucket: name }))
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await this.client.send(new CreateBucketCommand({ Bucket: name }));
      this.logger.log(`Created bucket: ${name}`);
    }

    // Set anonymous read policy for public bucket
    if (isPublic) {
      // MinIO SetBucketPolicy via S3 API
      const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${name}/*`],
          },
        ],
      });

      // Use MinIO admin client or mc alias for policy – here we log a reminder
      this.logger.warn(
        `Set public read policy for bucket "${name}" via MinIO Console or: ` +
        `mc anonymous set public minio/${name}`,
      );
    }
  }

  private mimeToExt(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
    };
    return map[mimeType] ?? '.bin';
  }
}
