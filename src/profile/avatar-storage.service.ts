import { BadRequestException, Injectable } from '@nestjs/common';
import { FileStorageService, StoredFile } from '../storage/file-storage.service';

const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export interface UploadedAvatar extends StoredFile {
  size: number;
  mimetype: string;
}

@Injectable()
export class AvatarStorageService {
  constructor(private readonly fileStorageService: FileStorageService) {}

  async saveAvatar(userId: number, avatar: UploadedAvatar): Promise<string> {
    this.validateAvatar(avatar);

    return this.fileStorageService.saveFile(avatar, {
      directory: 'avatars',
      fileNamePrefix: String(userId),
      extensionByMimeType: AVATAR_EXTENSION_BY_MIME_TYPE,
    });
  }

  async deleteAvatar(avatarKey: string): Promise<void> {
    await this.fileStorageService.deleteFile(avatarKey);
  }

  getAvatarUrl(avatarKey: string | null): string | null {
    return this.fileStorageService.getFileUrl(avatarKey);
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
