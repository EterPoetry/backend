import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'path';
import { FileStorageService, StoredFile } from '../storage/file-storage.service';

const POST_AUDIO_MAX_SIZE_BYTES = 80 * 1024 * 1024;
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.flac',
]);
const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
  'application/ogg',
]);
const SOURCE_AUDIO_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/vnd.wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'application/ogg': '.ogg',
};

export interface UploadedPostAudio extends StoredFile {
  size: number;
  mimetype: string;
}

@Injectable()
export class PostAudioStorageService {
  constructor(private readonly fileStorageService: FileStorageService) {}

  async saveSourceAudio(authorId: number, audio: UploadedPostAudio): Promise<string> {
    this.validateUploadedAudio(audio);

    return this.fileStorageService.saveFile(audio, {
      directory: 'posts/source-audio',
      fileNamePrefix: String(authorId),
      extensionByMimeType: SOURCE_AUDIO_EXTENSION_BY_MIME_TYPE,
      fallbackExtension: this.getOriginalExtension(audio) ?? '.bin',
    });
  }

  async saveProcessedAudio(authorId: number, audio: StoredFile): Promise<string> {
    return this.fileStorageService.saveFile(audio, {
      directory: 'posts/audio',
      fileNamePrefix: `${authorId}-opus`,
      extensionByMimeType: {
        'audio/opus': '.opus',
        'audio/ogg': '.opus',
      },
      fallbackExtension: '.opus',
    });
  }

  async deleteAudio(audioKey: string | null | undefined): Promise<void> {
    await this.fileStorageService.deleteFile(audioKey);
  }

  async readAudio(audioKey: string): Promise<StoredFile> {
    return this.fileStorageService.readFile(audioKey);
  }

  getAudioUrl(audioKey: string | null): string | null {
    return this.fileStorageService.getFileUrl(audioKey);
  }

  private validateUploadedAudio(audio: UploadedPostAudio): void {
    if (!audio.buffer?.length) {
      throw new BadRequestException('Audio file is empty.');
    }

    if (audio.size > POST_AUDIO_MAX_SIZE_BYTES) {
      throw new BadRequestException('Audio file is too large. Maximum size is 80 MB.');
    }

    const originalExtension = this.getOriginalExtension(audio);
    const isSupportedMimeType = SUPPORTED_UPLOAD_MIME_TYPES.has(audio.mimetype);
    const isSupportedExtension = originalExtension ? SUPPORTED_UPLOAD_EXTENSIONS.has(originalExtension) : false;

    if (!isSupportedMimeType && !isSupportedExtension) {
      const allowedFormats = Array.from(SUPPORTED_UPLOAD_EXTENSIONS)
        .map((extension) => extension.slice(1))
        .join(', ');

      throw new BadRequestException(
        `Unsupported audio format. Allowed formats: ${allowedFormats}.`,
      );
    }
  }

  private getOriginalExtension(audio: Pick<StoredFile, 'originalname'>): string | null {
    const extension = extname(audio.originalname ?? '').toLowerCase();
    return extension || null;
  }
}
