import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { PostStatus } from '../common/enums/post-status.enum';
import { SitemapCache } from './sitemap.cache';

const TTL_INDEX = 300;
const TTL_RECENT = 300;
const TTL_SHARD = 86400;

@Injectable()
export class SitemapService {
  private readonly siteUrl: string;
  private readonly shardSize: number;
  private readonly recentPostsCount: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly sitemapCache: SitemapCache,
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    this.siteUrl = configService.get<string>('PUBLIC_SITE_URL', 'https://eter.pp.ua').replace(/\/$/, '');
    this.shardSize = Number(configService.get<string>('SITEMAP_SHARD_SIZE', '50000'));
    this.recentPostsCount = Number(configService.get<string>('SITEMAP_RECENT_POSTS_COUNT', '5000'));
  }

  generateSitemapIndex(): Promise<string> {
    return this.sitemapCache.getOrSet('sitemap:index', TTL_INDEX, () => this.buildSitemapIndex());
  }

  generateRecentPostsSitemap(): Promise<string> {
    return this.sitemapCache.getOrSet('sitemap:recent-posts', TTL_RECENT, () => this.buildRecentPostsSitemap());
  }

  generatePostsSitemap(shard: number): Promise<string> {
    return this.sitemapCache.getOrSet(`sitemap:posts:${shard}`, TTL_SHARD, () => this.buildPostsSitemap(shard));
  }

  generateUsersSitemap(shard: number): Promise<string> {
    return this.sitemapCache.getOrSet(`sitemap:users:${shard}`, TTL_SHARD, () => this.buildUsersSitemap(shard));
  }

  // Truncates a date to a multiple of ttlSeconds so all processes within the same
  // cache window produce identical timestamps → identical ETag → single Cloudflare entry.
  private truncateToTtl(date: Date, ttlSeconds: number): Date {
    const ms = ttlSeconds * 1000;
    return new Date(Math.floor(date.getTime() / ms) * ms);
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async buildSitemapIndex(): Promise<string> {
    const TTL = TTL_INDEX;

    const [postShardStats, userShardStats, recentLastmod] = await Promise.all([
      this.getPostShardStats(),
      this.getUserShardStats(),
      this.getRecentPostsLastmod(),
    ]);

    const stable = (date: Date) => this.truncateToTtl(date, TTL).toISOString();

    const entries: string[] = [];

    entries.push(
      this.buildSitemapIndexEntry(
        `${this.siteUrl}/sitemaps/recent-posts.xml`,
        stable(recentLastmod ?? new Date()),
      ),
    );

    if (postShardStats.length === 0) {
      entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/posts-0.xml`, stable(new Date())));
    } else {
      for (const stat of postShardStats) {
        entries.push(
          this.buildSitemapIndexEntry(
            `${this.siteUrl}/sitemaps/posts-${Number(stat.shard_num)}.xml`,
            stable(new Date(stat.max_updated)),
          ),
        );
      }
    }

    if (userShardStats.length === 0) {
      entries.push(this.buildSitemapIndexEntry(`${this.siteUrl}/sitemaps/users-0.xml`, stable(new Date())));
    } else {
      for (const stat of userShardStats) {
        entries.push(
          this.buildSitemapIndexEntry(
            `${this.siteUrl}/sitemaps/users-${Number(stat.shard_num)}.xml`,
            stable(new Date(stat.max_updated)),
          ),
        );
      }
    }

    return this.wrapSitemapIndex(entries.join('\n'));
  }

  private async getPostShardStats(): Promise<Array<{ shard_num: string; max_updated: string }>> {
    return this.postRepository.query(
      `
      SELECT
        floor((rn - 1) / $1::int) AS shard_num,
        MAX(updated_at)            AS max_updated
      FROM (
        SELECT posts.updated_at, ROW_NUMBER() OVER (ORDER BY posts.post_id ASC) AS rn
        FROM posts
        INNER JOIN users ON users.user_id = posts.author_id
        WHERE posts.status = $2
          AND users.deleted_at IS NULL
      ) sub
      GROUP BY shard_num
      ORDER BY shard_num
      `,
      [this.shardSize, PostStatus.PUBLISHED],
    );
  }

  private async getUserShardStats(): Promise<Array<{ shard_num: string; max_updated: string }>> {
    return this.userRepository.query(
      `
      SELECT
        floor((rn - 1) / $1::int) AS shard_num,
        MAX(created_at)            AS max_updated
      FROM (
        SELECT created_at, ROW_NUMBER() OVER (ORDER BY user_id ASC) AS rn
        FROM users
        WHERE deleted_at IS NULL
      ) sub
      GROUP BY shard_num
      ORDER BY shard_num
      `,
      [this.shardSize],
    );
  }

  private async getRecentPostsLastmod(): Promise<Date | null> {
    const rows: Array<{ max_updated: string | null }> = await this.postRepository.query(
      `
      SELECT MAX(updated_at) AS max_updated
      FROM (
        SELECT posts.updated_at
        FROM posts
        INNER JOIN users ON users.user_id = posts.author_id
        WHERE posts.status = $1
          AND users.deleted_at IS NULL
        ORDER BY posts.post_id DESC
        LIMIT $2
      ) sub
      `,
      [PostStatus.PUBLISHED, this.recentPostsCount],
    );
    const val = rows[0]?.max_updated;
    return val ? new Date(val) : null;
  }

  private async buildPostsSitemap(shard: number): Promise<string> {
    if (!Number.isFinite(shard) || shard < 0) {
      return this.wrapUrlset([]);
    }

    const posts = await this.postRepository
      .createQueryBuilder('post')
      .innerJoin('post.author', 'author', 'author.deleted_at IS NULL')
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

  private async buildUsersSitemap(shard: number): Promise<string> {
    if (!Number.isFinite(shard) || shard < 0) {
      return this.wrapUrlset([]);
    }

    const users = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.userId', 'user.username', 'user.createdAt'])
      .where('user.deleted_at IS NULL')
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

  private async buildRecentPostsSitemap(): Promise<string> {
    const posts = await this.postRepository
      .createQueryBuilder('post')
      .innerJoin('post.author', 'author', 'author.deleted_at IS NULL')
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
