import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { extname } from 'path';
import { Repository } from 'typeorm';
import { PostStatus } from '../common/enums/post-status.enum';
import { Post } from '../posts/entities/post.entity';
import { FileStorageService } from '../storage/file-storage.service';
import { User } from '../users/entities/user.entity';
import { PageMetaResponse } from './dto/page-meta-response.dto';

const DEFAULT_SITE_NAME = 'Eter';
const DEFAULT_META_DESCRIPTION_FALLBACK = 'Discover audio posts and profiles on Eter.';
const DEFAULT_TITLE_MAX_LENGTH = 80;
const DEFAULT_DESCRIPTION_MAX_LENGTH = 180;
const AUDIO_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
};

@Injectable()
export class MetaService {
  constructor(
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async getPostMeta(postId: number): Promise<PageMetaResponse> {
    const post = await this.postsRepository.findOne({
      where: {
        postId,
        status: PostStatus.PUBLISHED,
      },
      relations: {
        author: true,
      },
    });

    if (!post) {
      throw new NotFoundException({ message: 'Not found' });
    }

    const authorName = this.normalizeMetaText(post.author?.name) || undefined;
    const originAuthorName = this.normalizeMetaText(post.originAuthorName) || undefined;
    const textSnippet = this.buildTextSnippet(post.text);
    const contentTitle = this.buildPostContentTitle(post, originAuthorName, authorName);
    const contentDescription = this.normalizeMetaText(post.description) || undefined;
    const poemParagraphs = this.buildPoemParagraphs(post.text);
    const poemText = poemParagraphs?.join('\n\n');
    const title = this.buildPostTitle(post, originAuthorName, authorName);
    const description = this.buildPostDescription(post, originAuthorName, authorName, textSnippet);
    const url = this.buildPublicUrl(`/posts/${post.postId}`);
    const audioFileUrl = this.resolveAudioFileUrl(post.audioFileName);

    return {
      title,
      description,
      image: this.getDefaultShareImageUrl(),
      url,
      canonical: url,
      type: 'article',
      ...(originAuthorName ? { originAuthorName } : {}),
      ...(authorName ? { authorName } : {}),
      ...(textSnippet ? { textSnippet } : {}),
      ...(contentTitle ? { contentTitle } : {}),
      ...(contentDescription ? { contentDescription } : {}),
      ...(poemText ? { poemText } : {}),
      ...(poemParagraphs?.length ? { poemParagraphs } : {}),
      ...(post.createdAt ? { publishedTime: post.createdAt.toISOString() } : {}),
      ...(audioFileUrl
        ? {
            audioFileUrl,
            audioMimeType: this.resolveAudioMimeType(post.audioFileName),
          }
        : {}),
      ...(typeof post.audioDurationSeconds === 'number'
        ? {
            audioDurationSeconds: post.audioDurationSeconds,
          }
        : {}),
    };
  }

  async getProfileMeta(profileUserId: number): Promise<PageMetaResponse> {
    const profile = await this.usersRepository.findOne({
      where: { userId: profileUserId },
    });

    if (!profile) {
      throw new NotFoundException({ message: 'Not found' });
    }

    const title = this.buildTitle(
      profile.name,
      profile.username,
      `Profile on ${this.getSiteName()}`,
      this.getDefaultMetaTitle(),
    );
    const description = this.buildDescription(
      null,
      null,
      `${title}'s profile on ${this.getSiteName()}`,
      this.getDefaultMetaDescription(),
    );
    const url = this.buildPublicUrl(`/profiles/${profile.userId}`);

    return {
      title,
      description,
      image: this.resolveImage(profile.photo ? this.fileStorageService.getFileUrl(profile.photo) : null),
      url,
      canonical: url,
      type: 'profile',
    };
  }

  private buildTitle(...candidates: Array<string | null | undefined>): string {
    const fallback = this.getDefaultMetaTitle();
    const value = candidates
      .map((candidate) => this.normalizeMetaText(candidate))
      .find((candidate) => candidate.length > 0);

    return this.truncateMetaText(value || fallback, DEFAULT_TITLE_MAX_LENGTH);
  }

  private buildDescription(...candidates: Array<string | null | undefined>): string {
    const fallback = this.getDefaultMetaDescription();
    const value = candidates
      .map((candidate) => this.normalizeMetaText(candidate))
      .find((candidate) => candidate.length > 0);

    return this.truncateMetaText(value || fallback, DEFAULT_DESCRIPTION_MAX_LENGTH);
  }

  private buildPostTitle(
    post: Post,
    originAuthorName?: string,
    authorName?: string,
  ): string {
    return this.buildTitle(
      post.title,
      originAuthorName ? `Poem by ${originAuthorName}` : null,
      authorName ? `Poem by ${authorName}` : null,
      post.audioFileName,
      this.getDefaultMetaTitle(),
    );
  }

  private buildPostContentTitle(
    post: Post,
    originAuthorName?: string,
    authorName?: string,
  ): string {
    return this.buildTitle(
      post.title,
      post.audioFileName,
      originAuthorName ? `Poem by ${originAuthorName}` : null,
      authorName ? `Poem by ${authorName}` : null,
      this.getDefaultMetaTitle(),
    );
  }

  private buildPostDescription(
    post: Post,
    originAuthorName?: string,
    authorName?: string,
    textSnippet?: string,
  ): string {
    const parts = [
      this.normalizeMetaText(post.description),
      originAuthorName ? `Original author: ${originAuthorName}.` : '',
      !originAuthorName && authorName ? `Author: ${authorName}.` : '',
      textSnippet ?? '',
    ].filter((part) => part.length > 0);

    if (parts.length === 0) {
      return this.buildDescription(
        `Listen to this post on ${this.getSiteName()}`,
        this.getDefaultMetaDescription(),
      );
    }

    return this.truncateMetaText(parts.join(' '), DEFAULT_DESCRIPTION_MAX_LENGTH);
  }

  private buildTextSnippet(value: string | null | undefined): string | undefined {
    const normalizedValue = this.normalizeMetaText(value);
    if (!normalizedValue) {
      return undefined;
    }

    return this.truncateMetaText(normalizedValue, 140);
  }

  private buildPoemParagraphs(value: string | null | undefined): string[] | undefined {
    if (!value) {
      return undefined;
    }

    const paragraphs = value
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((paragraph) => this.normalizeMetaText(paragraph))
      .filter((paragraph) => paragraph.length > 0);

    return paragraphs.length ? paragraphs : undefined;
  }

  private normalizeMetaText(value: string | null | undefined): string {
    return (value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncateMetaText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 1).trim()}…`;
  }

  private resolveImage(value: string | null | undefined): string {
    const normalizedValue = this.normalizeMetaText(value);
    if (!normalizedValue) {
      return this.getDefaultShareImageUrl();
    }

    if (normalizedValue.startsWith('http://') || normalizedValue.startsWith('https://')) {
      return normalizedValue;
    }

    const publicSiteUrl = this.getPublicSiteUrl();
    return `${publicSiteUrl}${normalizedValue.startsWith('/') ? '' : '/'}${normalizedValue}`;
  }

  private resolveAudioFileUrl(audioFileName: string | null | undefined): string | undefined {
    const audioUrl = audioFileName ? this.fileStorageService.getFileUrl(audioFileName) : null;
    const normalizedAudioUrl = this.normalizeMetaText(audioUrl);
    return normalizedAudioUrl || undefined;
  }

  private resolveAudioMimeType(audioFileName: string | null | undefined): string {
    const extension = extname(audioFileName ?? '').toLowerCase();
    return AUDIO_MIME_TYPE_BY_EXTENSION[extension] || 'audio/mpeg';
  }

  private buildPublicUrl(path: string): string {
    const publicSiteUrl = this.getPublicSiteUrl();
    return `${publicSiteUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private getPublicSiteUrl(): string {
    return (
      this.getTrimmedConfig('PUBLIC_SITE_URL') ||
      this.getOriginFromUrl(this.getTrimmedConfig('FRONTEND_AUTH_REDIRECT_URL')) ||
      this.getFirstCorsOrigin() ||
      this.getTrimmedConfig('APP_BASE_URL') ||
      'http://localhost:3000'
    );
  }

  private getSiteName(): string {
    return this.getTrimmedConfig('SITE_NAME') || DEFAULT_SITE_NAME;
  }

  private getDefaultMetaTitle(): string {
    return this.getTrimmedConfig('DEFAULT_META_TITLE') || this.getSiteName();
  }

  private getDefaultMetaDescription(): string {
    return this.getTrimmedConfig('DEFAULT_META_DESCRIPTION') || DEFAULT_META_DESCRIPTION_FALLBACK;
  }

  private getDefaultShareImageUrl(): string {
    return (
      this.resolveConfiguredAbsoluteUrl(this.getTrimmedConfig('DEFAULT_SHARE_IMAGE_URL'))
      || this.buildPublicUrl('/images/default-share.jpg')
    );
  }

  private resolveConfiguredAbsoluteUrl(value: string | null): string | null {
    if (!value) {
      return null;
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }

    return this.buildPublicUrl(value);
  }

  private getTrimmedConfig(key: string): string | null {
    const value = this.configService.get<string>(key)?.trim();
    return value || null;
  }

  private getOriginFromUrl(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  private getFirstCorsOrigin(): string | null {
    const corsOrigin = this.getTrimmedConfig('CORS_ORIGIN');
    if (!corsOrigin) {
      return null;
    }

    const firstOrigin = corsOrigin
      .split(',')
      .map((origin) => origin.trim())
      .find(Boolean);

    return firstOrigin || null;
  }

}
