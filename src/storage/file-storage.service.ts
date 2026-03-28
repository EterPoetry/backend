import { BadRequestException, Injectable } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join, posix } from 'path';

export interface StoredFile {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
}

export interface SaveFileOptions {
  directory: string;
  fileNamePrefix?: string;
  extensionByMimeType?: Record<string, string>;
  fallbackExtension?: string;
}

type StorageDriver = 'local' | 's3';

@Injectable()
export class FileStorageService {
  constructor(private readonly configService: ConfigService) {}

  async saveFile(file: StoredFile, options: SaveFileOptions): Promise<string> {
    const relativeDirectory = this.normalizeRelativePath(options.directory);
    const fileName = this.buildFileName(file, options);
    const fileKey = posix.join(relativeDirectory, fileName);
    const storageDriver = this.getStorageDriver();

    if (storageDriver === 'local') {
      const fullDirectoryPath = join(this.getUploadsRoot(), relativeDirectory);

      await mkdir(fullDirectoryPath, { recursive: true });
      await writeFile(join(fullDirectoryPath, fileName), file.buffer);

      return fileKey;
    }

    if (storageDriver === 's3') {
      const s3Client = this.createS3Client();

      await s3Client.send(
        new PutObjectCommand({
          Bucket: this.getRequiredConfig('S3_BUCKET'),
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      return fileKey;
    }

    return this.assertUnreachable(storageDriver);
  }

  async deleteFile(fileKey: string | null | undefined): Promise<void> {
    if (!fileKey || this.isRemoteUrl(fileKey)) {
      return;
    }

    const storageDriver = this.getStorageDriver();
    if (storageDriver === 's3') {
      try {
        await this.createS3Client().send(
          new DeleteObjectCommand({
            Bucket: this.getRequiredConfig('S3_BUCKET'),
            Key: this.normalizeRelativePath(fileKey),
          }),
        );
      } catch {
        return;
      }
      return;
    }

    if (storageDriver !== 'local') {
      return;
    }

    const normalizedFileKey = this.normalizeRelativePath(fileKey);
    const filePath = join(this.getUploadsRoot(), normalizedFileKey);

    try {
      await unlink(filePath);
    } catch {
      return;
    }
  }

  getFileUrl(fileKey: string | null | undefined): string | null {
    if (!fileKey) {
      return null;
    }

    if (this.isRemoteUrl(fileKey)) {
      return fileKey;
    }

    const normalizedFileKey = this.normalizeRelativePath(fileKey);
    const storageDriver = this.getStorageDriver();

    if (storageDriver === 's3') {
      return `${this.getRequiredConfig('S3_PUBLIC_BASE_URL').replace(/\/+$/, '')}/${normalizedFileKey}`;
    }

    const baseUrl = this.configService.get<string>('APP_BASE_URL', 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );

    return `${baseUrl}/uploads/${normalizedFileKey}`;
  }

  private buildFileName(file: StoredFile, options: SaveFileOptions): string {
    const extension =
      (file.mimetype && options.extensionByMimeType?.[file.mimetype]) ||
      extname(file.originalname ?? '').toLowerCase() ||
      options.fallbackExtension ||
      '.bin';
    const prefix = options.fileNamePrefix ? `${options.fileNamePrefix}-` : '';

    return `${prefix}${randomUUID()}${extension}`;
  }

  private getUploadsRoot(): string {
    return join(process.cwd(), 'uploads');
  }

  private getStorageDriver(): StorageDriver {
    const value = (this.configService.get<string>('FILE_STORAGE_DRIVER', 'local') ?? 'local').toLowerCase();

    if (value === 'local' || value === 's3') {
      return value;
    }

    throw new BadRequestException(`Unsupported file storage driver: ${value}.`);
  }

  private createS3Client(): S3Client {
    return new S3Client({
      region: this.configService.get<string>('S3_REGION') || 'auto',
      endpoint: this.configService.get<string>('S3_ENDPOINT') || undefined,
      forcePathStyle: this.configService.get<string>('S3_FORCE_PATH_STYLE', 'false') === 'true',
      credentials: {
        accessKeyId: this.getRequiredConfig('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.getRequiredConfig('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new BadRequestException(`${key} is not configured.`);
    }

    return value;
  }

  private isRemoteUrl(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://');
  }

  private normalizeRelativePath(value: string): string {
    return value.replace(/^\/+/, '').replace(/\\/g, '/');
  }

  private assertUnreachable(value: never): never {
    throw new BadRequestException(`Unsupported file storage driver: ${String(value)}.`);
  }
}
