import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export interface UploadedAvatar {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname?: string;
}

@Injectable()
export class AvatarStorageService {
  constructor(private readonly configService: ConfigService) {}

  async saveAvatar(userId: number, avatar: UploadedAvatar): Promise<string> {
    this.validateAvatar(avatar);

    const storageDriver = this.configService.get<string>('FILE_STORAGE_DRIVER', 'local');

    if (storageDriver !== 'local') {
      throw new BadRequestException(`Unsupported file storage driver: ${storageDriver}.`);
    }

    const extension =
      AVATAR_EXTENSION_BY_MIME_TYPE[avatar.mimetype] ||
      extname(avatar.originalname ?? '').toLowerCase() ||
      '.bin';
    const avatarDirectory = join(process.cwd(), 'uploads', 'avatars');

    await mkdir(avatarDirectory, { recursive: true });

    const fileName = `${userId}-${randomUUID()}${extension}`;
    const filePath = join(avatarDirectory, fileName);

    await writeFile(filePath, avatar.buffer);

    return `avatars/${fileName}`;
  }

  async deleteAvatar(avatarKey: string): Promise<void> {
    if (!avatarKey || avatarKey.startsWith('http://') || avatarKey.startsWith('https://')) {
      return;
    }

    const storageDriver = this.configService.get<string>('FILE_STORAGE_DRIVER', 'local');
    if (storageDriver !== 'local') {
      return;
    }

    const filePath = join(process.cwd(), 'uploads', avatarKey.replace(/^\/+/, ''));

    try {
      await unlink(filePath);
    } catch {
      return;
    }
  }

  getAvatarUrl(avatarKey: string | null): string | null {
    if (!avatarKey) {
      return null;
    }

    if (avatarKey.startsWith('http://') || avatarKey.startsWith('https://')) {
      return avatarKey;
    }

    const baseUrl = this.configService.get<string>('APP_BASE_URL', 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );

    return `${baseUrl}/uploads/${avatarKey.replace(/^\/+/, '')}`;
  }

  private validateAvatar(avatar: UploadedAvatar): void {
    if (!avatar.buffer?.length) {
      throw new BadRequestException('Avatar file is empty.');
    }

    if (avatar.size > AVATAR_MAX_SIZE_BYTES) {
      throw new BadRequestException('Avatar file is too large. Maximum size is 5 MB.');
    }

    if (!ALLOWED_AVATAR_MIME_TYPES.has(avatar.mimetype)) {
      throw new BadRequestException('Avatar must be a JPEG, PNG, or WebP image.');
    }
  }
}
