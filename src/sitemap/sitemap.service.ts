import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { PostStatus } from '../common/enums/post-status.enum';

@Injectable()
export class SitemapService {
  private readonly siteUrl: string;
  private readonly shardSize: number;
  private readonly recentPostsCount: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    this.siteUrl = configService.get<string>('PUBLIC_SITE_URL', 'https://eter.pp.ua').replace(/\/$/, '');
    this.shardSize = Number(configService.get<string>('SITEMAP_SHARD_SIZE', '50000'));
    this.recentPostsCount = Number(configService.get<string>('SITEMAP_RECENT_POSTS_COUNT', '5000'));
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async generateSitemapIndex(): Promise<string> {
    const now = new Date().toISOString();

    const [postCount, userCount] = await Promise.all([
      this.postRepository.count({ where: { status: PostStatus.PUBLISHED } }),
      this.userRepository.count(),
    ]);

    const postShards = Math.ceil(postCount / this.shardSize) || 1;
    const userShards = Math.ceil(userCount / this.shardSize) || 1;

    const entries: string[] = [];

    entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/recent-posts.xml`, now));

    for (let i = 0; i < postShards; i++) {
      entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/posts-${i}.xml`, now));
    }

    for (let i = 0; i < userShards; i++) {
      entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/users-${i}.xml`, now));
    }

    return this.wrapSitemapIndex(entries.join('\n'));
  }

  async generatePostsSitemap(shard: number): Promise<string> {
    if (!Number.isFinite(shard) || shard < 0) {
      return this.wrapUrlset([]);
    }

    const posts = await this.postRepository
      .createQueryBuilder('post')
      .select(['post.postId', 'post.updatedAt'])
      .where('post.status = :status', { status: PostStatus.PUBLISHED })
      .orderBy('post.postId', 'ASC')
      .skip(shard * this.shardSize)
      .take(this.shardSize)
      .getMany();

    const entries = posts.map((post) =>
      this.buildUrlEntry(
        `${this.siteUrl}/posts/${post.postId}`,
        post.updatedAt,
      ),
    );

    return this.wrapUrlset(entries);
  }

  async generateUsersSitemap(shard: number): Promise<string> {
    if (!Number.isFinite(shard) || shard < 0) {
      return this.wrapUrlset([]);
    }

    const users = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.userId', 'user.username', 'user.createdAt'])
      .orderBy('user.userId', 'ASC')
      .skip(shard * this.shardSize)
      .take(this.shardSize)
      .getMany();

    const entries = users.map((user) =>
      this.buildUrlEntry(
        `${this.siteUrl}/users/${this.escapeXml(user.username)}`,
        user.createdAt,
      ),
    );

    return this.wrapUrlset(entries);
  }

  async generateRecentPostsSitemap(): Promise<string> {
    const posts = await this.postRepository
      .createQueryBuilder('post')
      .select(['post.postId', 'post.updatedAt'])
      .where('post.status = :status', { status: PostStatus.PUBLISHED })
      .orderBy('post.postId', 'DESC')
      .take(this.recentPostsCount)
      .getMany();

    const entries = posts.map((post) =>
      this.buildUrlEntry(
        `${this.siteUrl}/posts/${post.postId}`,
        post.updatedAt,
      ),
    );

    return this.wrapUrlset(entries);
  }

  private buildSitemapIndexEntry(loc: string, lastmod: string): string {
    return `  <sitemap>\n    <loc>${this.escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </sitemap>`;
  }

  private buildUrlEntry(loc: string, lastmod: Date): string {
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod.toISOString()}</lastmod>\n  </url>`;
  }

  private wrapSitemapIndex(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${inner}\n</sitemapindex>`;
  }

  private wrapUrlset(entries: string[]): string {
    const inner = entries.length > 0 ? '\n' + entries.join('\n') + '\n' : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${inner}</urlset>`;
  }
}
