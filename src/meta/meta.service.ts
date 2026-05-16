import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
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

    const authorName = this.firstNonEmpty(post.author?.name, post.originAuthorName, 'author');
    const title = this.buildTitle(
      post.title,
      post.audioFileName,
      `Post by ${authorName}`,
      this.getDefaultMetaTitle(),
    );
    const description = this.buildDescription(
      post.description,
      post.text,
      `Listen to this post on ${this.getSiteName()}`,
      this.getDefaultMetaDescription(),
    );
    const url = this.buildPublicUrl(`/posts/${post.postId}`);

    return {
      title,
      description,
      image: this.resolveImage(post.author?.photo ? this.fileStorageService.getFileUrl(post.author.photo) : null),
      url,
      canonical: url,
      type: 'article',
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

  private buildPublicUrl(path: string): string {
    const publicSiteUrl = this.getPublicSiteUrl();
    return `${publicSiteUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private getPublicSiteUrl(): string {
    return this.getTrimmedConfig('PUBLIC_SITE_URL')
      || this.getTrimmedConfig('APP_BASE_URL')
      || 'http://localhost:3000';
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

  private firstNonEmpty(...values: Array<string | null | undefined>): string {
    return (
      values
        .map((value) => this.normalizeMetaText(value))
        .find((value) => value.length > 0) || ''
    );
  }
}
